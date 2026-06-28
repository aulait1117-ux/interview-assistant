import os
import uuid
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, Header
from aiosqlite import Connection
from pydantic import BaseModel
from database import get_db
from routes.auth import get_current_user
from services.auth_service import PLANS

router = APIRouter(prefix="/api/billing", tags=["billing"])

STRIPE_SECRET = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
PAYPAY_API_KEY = os.getenv("PAYPAY_API_KEY", "")
PAYPAY_API_SECRET = os.getenv("PAYPAY_API_SECRET", "")
PAYPAY_MERCHANT_ID = os.getenv("PAYPAY_MERCHANT_ID", "")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

PLAN_PRICES = {
    "day1h":   {"amount": 500,  "label": "1日1時間プラン"},
    "day24h":  {"amount": 1000, "label": "1日使い放題プラン"},
    "monthly": {"amount": 2000, "label": "月額使い放題プラン"},
    "monthly_discount": {"amount": 1000, "label": "月額プラン（割引）"},
}


class CheckoutRequest(BaseModel):
    plan: str
    provider: str  # "stripe" | "paypay"


@router.get("/plans")
async def get_plans(user=Depends(get_current_user)):
    result = []
    for key, info in PLANS.items():
        if key == "free":
            continue
        price_info = PLAN_PRICES.get(key, {})
        plan = {
            "id": key,
            "name": info["name"],
            "price": info["price"],
            "minutes": info["minutes"],
            "label": price_info.get("label", info["name"]),
        }
        if key == "monthly_discount" and not user["used_day_plan"]:
            continue
        result.append(plan)
    return result


@router.post("/checkout")
async def checkout(req: CheckoutRequest, user=Depends(get_current_user), db: Connection = Depends(get_db)):
    if req.plan not in PLAN_PRICES:
        raise HTTPException(status_code=400, detail="無効なプランです")

    if req.plan == "monthly_discount" and not user["used_day_plan"]:
        raise HTTPException(status_code=400, detail="1日プランの利用履歴がないため割引を適用できません")

    plan_info = PLAN_PRICES[req.plan]
    payment_id = str(uuid.uuid4())

    if req.provider == "stripe":
        return await _stripe_checkout(payment_id, req.plan, plan_info, user, db)
    elif req.provider == "paypay":
        return await _paypay_checkout(payment_id, req.plan, plan_info, user, db)
    else:
        raise HTTPException(status_code=400, detail="無効な決済プロバイダーです")


async def _stripe_checkout(payment_id: str, plan: str, plan_info: dict, user: dict, db: Connection):
    if not STRIPE_SECRET:
        raise HTTPException(status_code=503, detail="Stripe未設定。.envにSTRIPE_SECRET_KEYを追加してください")
    try:
        import stripe
        stripe.api_key = STRIPE_SECRET
        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            line_items=[{
                "price_data": {
                    "currency": "jpy",
                    "product_data": {"name": plan_info["label"]},
                    "unit_amount": plan_info["amount"],
                },
                "quantity": 1,
            }],
            mode="payment",
            success_url=f"{FRONTEND_URL}/payment/success?session_id={{CHECKOUT_SESSION_ID}}&plan={plan}",
            cancel_url=f"{FRONTEND_URL}/pricing",
            metadata={"user_id": user["id"], "plan": plan, "payment_id": payment_id},
        )
        await db.execute(
            "INSERT INTO payments (id, user_id, plan, amount, provider, provider_payment_id, status) VALUES (?,?,?,?,?,?,?)",
            (payment_id, user["id"], plan, plan_info["amount"], "stripe", session.id, "pending")
        )
        await db.commit()
        return {"checkout_url": session.url, "provider": "stripe"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def _paypay_checkout(payment_id: str, plan: str, plan_info: dict, user: dict, db: Connection):
    if not PAYPAY_API_KEY:
        raise HTTPException(status_code=503, detail="PayPay未設定。.envにPAYPAY_API_KEY等を追加してください")
    try:
        import paypayopa
        client = paypayopa.Client(
            headers={"PAYPAY_API_KEY": PAYPAY_API_KEY, "PAYPAY_API_SECRET": PAYPAY_API_SECRET},
            auth_header=True,
            response_type=paypayopa.Constants.REQUEST_TOKEN,
        )
        client.set_assumption_id(PAYPAY_MERCHANT_ID)
        payload = {
            "merchantPaymentId": payment_id,
            "amount": {"amount": plan_info["amount"], "currency": "JPY"},
            "codeType": "ORDER_QR",
            "redirectUrl": f"{FRONTEND_URL}/payment/success?plan={plan}",
            "redirectType": "WEB_LINK",
            "orderDescription": plan_info["label"],
        }
        response = client.Code.createQRCode(payload)
        url = response["data"]["url"]
        await db.execute(
            "INSERT INTO payments (id, user_id, plan, amount, provider, provider_payment_id, status) VALUES (?,?,?,?,?,?,?)",
            (payment_id, user["id"], plan, plan_info["amount"], "paypay", payment_id, "pending")
        )
        await db.commit()
        return {"checkout_url": url, "provider": "paypay"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stripe/webhook")
async def stripe_webhook(request: Request, db: Connection = Depends(get_db)):
    if not STRIPE_SECRET:
        return {"status": "skipped"}
    import stripe
    stripe.api_key = STRIPE_SECRET
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid signature")

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        meta = session.get("metadata", {})
        await _activate_plan(meta.get("user_id"), meta.get("plan"), meta.get("payment_id"), db)
    return {"status": "ok"}


@router.post("/payment/success")
async def payment_success(plan: str, user=Depends(get_current_user), db: Connection = Depends(get_db)):
    await _activate_plan(user["id"], plan, None, db)
    return {"status": "ok", "plan": plan}


async def _activate_plan(user_id: str, plan: str, payment_id: str | None, db: Connection):
    now = datetime.utcnow()
    if plan in ("day1h", "day24h"):
        expires_at = now + timedelta(hours=24)
        await db.execute(
            "UPDATE users SET plan=?, plan_expires_at=?, trial_minutes_used=0, used_day_plan=1 WHERE id=?",
            (plan, expires_at.isoformat(), user_id)
        )
    elif plan in ("monthly", "monthly_discount"):
        expires_at = now + timedelta(days=31)
        await db.execute(
            "UPDATE users SET plan=?, plan_expires_at=?, trial_minutes_used=0 WHERE id=?",
            (plan, expires_at.isoformat(), user_id)
        )
    if payment_id:
        await db.execute("UPDATE payments SET status='completed' WHERE id=?", (payment_id,))
    await db.commit()


@router.post("/track-usage")
async def track_usage(minutes: int, user=Depends(get_current_user), db: Connection = Depends(get_db)):
    await db.execute(
        "UPDATE users SET trial_minutes_used = trial_minutes_used + ? WHERE id=?",
        (minutes, user["id"])
    )
    await db.commit()
    cursor = await db.execute(
        "SELECT plan, trial_minutes_used FROM users WHERE id=?", (user["id"],)
    )
    row = await cursor.fetchone()
    plan_info = PLANS.get(row[0], PLANS["free"])
    minutes_left = max(0, plan_info["minutes"] - row[1])
    return {"minutes_left": minutes_left, "plan": row[0]}
