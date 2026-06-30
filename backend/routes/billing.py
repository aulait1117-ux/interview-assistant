import os
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Request, Header
from aiosqlite import Connection
from pydantic import BaseModel
from dotenv import load_dotenv
from database import get_db
from routes.auth import get_current_user
from services.auth_service import PLANS

load_dotenv(Path(__file__).parent.parent.parent / ".env")

router = APIRouter(prefix="/api/billing", tags=["billing"])

STRIPE_SECRET = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
PAYPAY_API_KEY = os.getenv("PAYPAY_API_KEY", "")
PAYPAY_API_SECRET = os.getenv("PAYPAY_API_SECRET", "")
PAYPAY_MERCHANT_ID = os.getenv("PAYPAY_MERCHANT_ID", "")
LINEPAY_CHANNEL_ID = os.getenv("LINEPAY_CHANNEL_ID", "")
LINEPAY_CHANNEL_SECRET = os.getenv("LINEPAY_CHANNEL_SECRET", "")
AMAZON_PAY_PUBLIC_KEY_ID = os.getenv("AMAZON_PAY_PUBLIC_KEY_ID", "")
AMAZON_PAY_PRIVATE_KEY = os.getenv("AMAZON_PAY_PRIVATE_KEY", "")
DPAYMENT_API_KEY = os.getenv("DPAYMENT_API_KEY", "")
AUPAY_API_KEY = os.getenv("AUPAY_API_KEY", "")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

PLAN_PRICES = {
    "day1h":   {"amount": 500,  "label": "1日1時間プラン"},
    "day24h":  {"amount": 1000, "label": "1日使い放題プラン"},
    "monthly": {"amount": 2000, "label": "月額使い放題プラン"},
    "monthly_discount": {"amount": 1000, "label": "月額プラン（割引）"},
}

# 利用可能な決済プロバイダー一覧（フロントエンド表示用）
PROVIDERS = [
    {"id": "stripe_card",    "label": "クレジット/デビットカード", "icon": "💳", "available": True},
    {"id": "stripe_konbini", "label": "コンビニ払い",              "icon": "🏪", "available": True},
    {"id": "paypay",         "label": "PayPay",                    "icon": "🟡", "available": bool(PAYPAY_API_KEY)},
    {"id": "linepay",        "label": "LINE Pay",                  "icon": "💚", "available": bool(LINEPAY_CHANNEL_ID)},
    {"id": "amazonpay",      "label": "Amazon Pay",                "icon": "📦", "available": bool(AMAZON_PAY_PUBLIC_KEY_ID)},
    {"id": "d_payment",      "label": "d払い",                     "icon": "📱", "available": bool(DPAYMENT_API_KEY)},
    {"id": "aupay",          "label": "au PAY",                    "icon": "🔵", "available": bool(AUPAY_API_KEY)},
]


class CheckoutRequest(BaseModel):
    plan: str
    provider: str  # "stripe_card" | "stripe_konbini" | "paypay" | "linepay" | "amazonpay" | "d_payment" | "aupay"


@router.get("/providers")
async def get_providers():
    return PROVIDERS


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

    if req.provider == "stripe_card":
        return await _stripe_checkout(payment_id, req.plan, plan_info, "card", user, db)
    elif req.provider == "stripe_konbini":
        return await _stripe_checkout(payment_id, req.plan, plan_info, "konbini", user, db)
    elif req.provider == "paypay":
        return await _paypay_checkout(payment_id, req.plan, plan_info, user, db)
    elif req.provider == "linepay":
        return await _linepay_checkout(payment_id, req.plan, plan_info, user, db)
    elif req.provider == "amazonpay":
        raise HTTPException(status_code=503, detail="Amazon Payは準備中です。しばらくお待ちください。")
    elif req.provider == "d_payment":
        raise HTTPException(status_code=503, detail="d払いは準備中です。しばらくお待ちください。")
    elif req.provider == "aupay":
        raise HTTPException(status_code=503, detail="au PAYは準備中です。しばらくお待ちください。")
    else:
        raise HTTPException(status_code=400, detail="無効な決済プロバイダーです")


async def _stripe_checkout(payment_id: str, plan: str, plan_info: dict, method: str, user: dict, db: Connection):
    if not STRIPE_SECRET:
        raise HTTPException(status_code=503, detail="Stripe未設定。.envにSTRIPE_SECRET_KEYを追加してください")
    try:
        import stripe
        stripe.api_key = STRIPE_SECRET

        if method == "konbini":
            session_params = {
                "payment_method_types": ["konbini"],
                "payment_method_options": {
                    "konbini": {"expires_after_days": 3}
                },
            }
        else:
            # カード + Apple Pay / Google Pay（Stripe Checkoutが自動でウォレット表示）
            session_params = {
                "payment_method_types": ["card"],
            }

        session = stripe.checkout.Session.create(
            **session_params,
            line_items=[{
                "price_data": {
                    "currency": "jpy",
                    "product_data": {"name": plan_info["label"]},
                    "unit_amount": plan_info["amount"],
                },
                "quantity": 1,
            }],
            mode="payment",
            success_url=f"{FRONTEND_URL}/?plan={plan}&session_id={{CHECKOUT_SESSION_ID}}&method={method}",
            cancel_url=f"{FRONTEND_URL}/",
            metadata={"user_id": user["id"], "plan": plan, "payment_id": payment_id, "method": method},
        )
        await db.execute(
            "INSERT INTO payments (id, user_id, plan, amount, provider, provider_payment_id, status) VALUES (?,?,?,?,?,?,?)",
            (payment_id, user["id"], plan, plan_info["amount"], f"stripe_{method}", session.id, "pending")
        )
        await db.commit()
        return {"checkout_url": session.url, "provider": "stripe", "method": method}
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


async def _linepay_checkout(payment_id: str, plan: str, plan_info: dict, user: dict, db: Connection):
    if not LINEPAY_CHANNEL_ID:
        raise HTTPException(status_code=503, detail="LINE Payは準備中です。しばらくお待ちください。")
    try:
        import hmac
        import hashlib
        import base64
        import json
        import httpx
        import time

        nonce = str(uuid.uuid4())
        timestamp = str(int(time.time() * 1000))
        body = json.dumps({
            "amount": plan_info["amount"],
            "currency": "JPY",
            "orderId": payment_id,
            "packages": [{
                "id": plan,
                "amount": plan_info["amount"],
                "name": plan_info["label"],
                "products": [{
                    "name": plan_info["label"],
                    "quantity": 1,
                    "price": plan_info["amount"],
                }],
            }],
            "redirectUrls": {
                "confirmUrl": f"{FRONTEND_URL}/?plan={plan}&payment_id={payment_id}&method=linepay",
                "cancelUrl": f"{FRONTEND_URL}/",
            },
        })

        text = LINEPAY_CHANNEL_SECRET + "/v3/payments/request" + body + nonce + timestamp
        signature = base64.b64encode(
            hmac.new(LINEPAY_CHANNEL_SECRET.encode(), text.encode(), hashlib.sha256).digest()
        ).decode()

        headers = {
            "Content-Type": "application/json",
            "X-LINE-ChannelId": LINEPAY_CHANNEL_ID,
            "X-LINE-Authorization-Nonce": nonce,
            "X-LINE-Authorization": signature,
            "X-LINE-MsgId": timestamp,
        }

        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://api-pay.line.me/v3/payments/request",
                headers=headers,
                content=body,
            )
        data = res.json()
        if data.get("returnCode") != "0000":
            raise Exception(data.get("returnMessage", "LINE Pay error"))

        url = data["info"]["paymentUrl"]["web"]
        await db.execute(
            "INSERT INTO payments (id, user_id, plan, amount, provider, provider_payment_id, status) VALUES (?,?,?,?,?,?,?)",
            (payment_id, user["id"], plan, plan_info["amount"], "linepay", payment_id, "pending")
        )
        await db.commit()
        return {"checkout_url": url, "provider": "linepay"}
    except HTTPException:
        raise
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
        # カード決済は即時確定（payment_status=paid）、コンビニは非同期なのでここでは無視
        if session.get("payment_status") == "paid":
            meta = session.get("metadata", {})
            await _activate_plan(meta.get("user_id"), meta.get("plan"), meta.get("payment_id"), db)

    elif event["type"] == "checkout.session.async_payment_succeeded":
        # コンビニ払い完了（レジで支払われた）
        session = event["data"]["object"]
        meta = session.get("metadata", {})
        await _activate_plan(meta.get("user_id"), meta.get("plan"), meta.get("payment_id"), db)

    elif event["type"] == "checkout.session.async_payment_failed":
        # コンビニ払い期限切れ・失敗
        session = event["data"]["object"]
        meta = session.get("metadata", {})
        if meta.get("payment_id"):
            await db.execute("UPDATE payments SET status='failed' WHERE id=?", (meta["payment_id"],))
            await db.commit()

    return {"status": "ok"}


@router.post("/payment/success")
async def payment_success(
    plan: str,
    checkout_session_id: str | None = None,
    user=Depends(get_current_user),
    db: Connection = Depends(get_db),
):
    """Stripe決済完了後のコールバック。checkout_session_idをStripeで検証してからプランを有効化する。"""
    if not STRIPE_SECRET:
        raise HTTPException(status_code=503, detail="Stripe未設定のため決済確認できません")

    if not checkout_session_id:
        raise HTTPException(status_code=400, detail="checkout_session_idが必要です")

    if plan not in PLAN_PRICES:
        raise HTTPException(status_code=400, detail="無効なプランです")

    try:
        import stripe
        stripe.api_key = STRIPE_SECRET
        session = stripe.checkout.Session.retrieve(checkout_session_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Stripe検証エラー: {e}")

    if session.get("payment_status") != "paid":
        # コンビニ払い等の非同期決済 - webhookで有効化される
        raise HTTPException(status_code=402, detail="payment_pending")

    meta = session.get("metadata", {})
    if str(meta.get("user_id")) != str(user["id"]):
        raise HTTPException(status_code=403, detail="ユーザーIDが一致しません")

    if meta.get("plan") != plan:
        raise HTTPException(status_code=400, detail="プランが一致しません")

    payment_id = meta.get("payment_id")
    await _activate_plan(user["id"], plan, payment_id, db)
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
