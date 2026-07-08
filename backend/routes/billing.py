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

# 自動更新サブスク（Stripe mode="subscription"）で扱うプラン（2026-07-08、社長判断）。
# それ以外（day1h/day24h）は従来どおり mode="payment" の都度課金。
SUBSCRIPTION_PLANS = {"monthly", "monthly_discount"}
# サブスクの課金周期（日数）。既存の都度課金monthlyと同じ31日周期を踏襲。
SUBSCRIPTION_PERIOD_DAYS = 31
# カード明細に出る表記。身に覚えのない請求」型チャージバックを減らすため明確化（財務部試算の最優先対策）。
# ※アカウント全体の statement descriptor は Stripe ダッシュボード側設定が優先されるため、そちらも "InterviewAI" に設定すること。
STATEMENT_DESCRIPTOR = "INTERVIEWAI"

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

    # 自動更新サブスク（monthly系）はカード決済のみ対応。
    # コンビニ払い・PayPay・LINE Payは継続課金（オートリニューアル）に対応しないため拒否する。
    if req.plan in SUBSCRIPTION_PLANS and req.provider != "stripe_card":
        raise HTTPException(
            status_code=400,
            detail="月額プラン（自動更新）はクレジット/デビットカードのみご利用いただけます。",
        )

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

        is_subscription = plan in SUBSCRIPTION_PLANS
        common = {
            "success_url": f"{FRONTEND_URL}/?plan={plan}&session_id={{CHECKOUT_SESSION_ID}}&method={method}",
            "cancel_url": f"{FRONTEND_URL}/",
            "metadata": {"user_id": user["id"], "plan": plan, "payment_id": payment_id, "method": method},
        }

        if is_subscription:
            # 自動更新サブスク（mode="subscription"）。カードのみ。
            # 既にStripe顧客IDがあれば再利用（無ければStripeがcheckoutで作成し、webhookで保存）。
            customer_id = user.get("stripe_customer_id")
            session = stripe.checkout.Session.create(
                payment_method_types=["card"],
                line_items=[{
                    "price_data": {
                        "currency": "jpy",
                        "product_data": {"name": f"InterviewAI {plan_info['label']}"},
                        "unit_amount": plan_info["amount"],
                        "recurring": {"interval": "month"},
                    },
                    "quantity": 1,
                }],
                mode="subscription",
                # サブスク側にもmetadataを持たせ、invoice.paid等のwebhookでuser/planを引けるようにする
                subscription_data={
                    "metadata": {"user_id": user["id"], "plan": plan, "payment_id": payment_id},
                },
                **({"customer": customer_id} if customer_id else {"customer_email": user.get("email")}),
                **common,
            )
        else:
            # 都度課金（day系・monthly系以外）。従来どおり mode="payment"。
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
                # カード明細の表記を明確化（"身に覚えのない請求"型チャージバック対策）
                payment_intent_data={"statement_descriptor_suffix": STATEMENT_DESCRIPTOR},
                **common,
            )

        await db.execute(
            "INSERT INTO payments (id, user_id, plan, amount, provider, provider_payment_id, status) VALUES (?,?,?,?,?,?,?)",
            (payment_id, user["id"], plan, plan_info["amount"], f"stripe_{'sub' if is_subscription else method}", session.id, "pending")
        )
        await db.commit()
        return {"checkout_url": session.url, "provider": "stripe", "method": method, "subscription": is_subscription}
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
        meta = session.get("metadata", {})
        if session.get("mode") == "subscription":
            # 自動更新サブスクの初回決済。顧客ID・サブスクIDを保存し、状態activeでプラン有効化。
            if session.get("payment_status") in ("paid", "no_payment_required"):
                await db.execute(
                    "UPDATE users SET stripe_customer_id=?, stripe_subscription_id=?, "
                    "subscription_status='active', cancel_at_period_end=0 WHERE id=?",
                    (session.get("customer"), session.get("subscription"), meta.get("user_id")),
                )
                await db.commit()
                await _activate_plan(meta.get("user_id"), meta.get("plan"), meta.get("payment_id"), db)
        else:
            # 都度課金カード決済は即時確定（payment_status=paid）、コンビニは非同期なのでここでは無視
            if session.get("payment_status") == "paid":
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

    elif event["type"] == "invoice.paid":
        # サブスクの継続課金（2回目以降の自動更新）。初回は checkout.session.completed で処理済み。
        invoice = event["data"]["object"]
        if invoice.get("billing_reason") == "subscription_cycle":
            sub_id = invoice.get("subscription")
            user_id = await _find_user_id(db, subscription_id=sub_id, customer_id=invoice.get("customer"))
            if user_id:
                # planはサブスクmetadata優先、無ければDB上の現行プランを維持（monthly_discount取り違え防止）
                sub_meta = (invoice.get("subscription_details") or {}).get("metadata") or {}
                plan = sub_meta.get("plan")
                await _renew_subscription(user_id, plan, db)

    elif event["type"] == "invoice.payment_failed":
        # 自動更新の決済失敗（カード期限切れ等）。past_dueにする（Stripeがリトライ／最終的にdeletedを送る）。
        invoice = event["data"]["object"]
        user_id = await _find_user_id(db, subscription_id=invoice.get("subscription"), customer_id=invoice.get("customer"))
        if user_id:
            await db.execute("UPDATE users SET subscription_status='past_due' WHERE id=?", (user_id,))
            await db.commit()

    elif event["type"] == "customer.subscription.deleted":
        # サブスク終了（期末解約の確定、またはリトライ切れ）。状態をcanceledにする。
        # プランはplan_expires_at満了時にget_current_userの自動ダウングレードで無料へ戻る。
        sub = event["data"]["object"]
        user_id = await _find_user_id(db, subscription_id=sub.get("id"), customer_id=sub.get("customer"))
        if user_id:
            await db.execute(
                "UPDATE users SET subscription_status='canceled', cancel_at_period_end=0 WHERE id=?",
                (user_id,),
            )
            await db.commit()

    return {"status": "ok"}


async def _find_user_id(db: Connection, subscription_id: str | None = None, customer_id: str | None = None):
    """Stripeのサブスク/顧客IDからユーザーIDを引く。サブスクID優先。"""
    if subscription_id:
        cur = await db.execute("SELECT id FROM users WHERE stripe_subscription_id=?", (subscription_id,))
        row = await cur.fetchone()
        if row:
            return row[0]
    if customer_id:
        cur = await db.execute("SELECT id FROM users WHERE stripe_customer_id=?", (customer_id,))
        row = await cur.fetchone()
        if row:
            return row[0]
    return None


async def _renew_subscription(user_id: str, plan: str | None, db: Connection):
    """自動更新：利用期限を現在の期限（未来なら）またはnowから31日延長し、状態をactiveへ。
    plan未指定時はDB上の現行プランを維持する（monthly/monthly_discountの取り違え防止）。"""
    now = datetime.utcnow()
    cur = await db.execute("SELECT plan, plan_expires_at FROM users WHERE id=?", (user_id,))
    row = await cur.fetchone()
    current_plan = row[0] if row else None
    # metadata優先。無ければ現行プラン。それも無ければ月額扱い。
    plan = plan or (current_plan if current_plan in SUBSCRIPTION_PLANS else "monthly")
    base = now
    if row and row[1]:
        try:
            current = datetime.fromisoformat(str(row[1]).replace("Z", "+00:00")).replace(tzinfo=None)
            if current > now:
                base = current
        except Exception:
            base = now
    expires_at = base + timedelta(days=SUBSCRIPTION_PERIOD_DAYS)
    await db.execute(
        "UPDATE users SET plan=?, plan_expires_at=?, subscription_status='active', trial_minutes_used=0 WHERE id=?",
        (plan, expires_at.isoformat(), user_id),
    )
    await db.commit()


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
    # サブスクの場合は顧客ID・サブスクIDもここで保存しておく（webhook遅延時も解約が効くように）
    if session.get("mode") == "subscription" and session.get("subscription"):
        await db.execute(
            "UPDATE users SET stripe_customer_id=?, stripe_subscription_id=?, "
            "subscription_status='active', cancel_at_period_end=0 WHERE id=?",
            (session.get("customer"), session.get("subscription"), user["id"]),
        )
        await db.commit()
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


@router.get("/subscription")
async def get_subscription(user=Depends(get_current_user)):
    """現在のサブスク状態（UI表示用）。DBの保持値を返す（Stripeへは問い合わせない）。"""
    has_sub = bool(user.get("stripe_subscription_id")) and user.get("subscription_status") in ("active", "past_due")
    return {
        "has_subscription": has_sub,
        "status": user.get("subscription_status"),
        "cancel_at_period_end": bool(user.get("cancel_at_period_end")),
        "plan": user.get("plan"),
        "plan_expires_at": user.get("plan_expires_at"),
    }


@router.post("/subscription/cancel")
async def cancel_subscription(user=Depends(get_current_user), db: Connection = Depends(get_db)):
    """自動更新を停止（期末解約）。当該期間の満了日までは引き続き利用可能。"""
    sub_id = user.get("stripe_subscription_id")
    if not sub_id or user.get("subscription_status") not in ("active", "past_due"):
        raise HTTPException(status_code=400, detail="有効な自動更新サブスクがありません")
    if not STRIPE_SECRET:
        raise HTTPException(status_code=503, detail="Stripe未設定")
    try:
        import stripe
        stripe.api_key = STRIPE_SECRET
        stripe.Subscription.modify(sub_id, cancel_at_period_end=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"解約処理でエラー: {e}")
    await db.execute("UPDATE users SET cancel_at_period_end=1 WHERE id=?", (user["id"],))
    await db.commit()
    return {"status": "ok", "cancel_at_period_end": True, "plan_expires_at": user.get("plan_expires_at")}


@router.post("/subscription/resume")
async def resume_subscription(user=Depends(get_current_user), db: Connection = Depends(get_db)):
    """期末解約の予約を取り消し、自動更新を継続する。"""
    sub_id = user.get("stripe_subscription_id")
    if not sub_id or user.get("subscription_status") not in ("active", "past_due"):
        raise HTTPException(status_code=400, detail="有効な自動更新サブスクがありません")
    if not STRIPE_SECRET:
        raise HTTPException(status_code=503, detail="Stripe未設定")
    try:
        import stripe
        stripe.api_key = STRIPE_SECRET
        stripe.Subscription.modify(sub_id, cancel_at_period_end=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"再開処理でエラー: {e}")
    await db.execute("UPDATE users SET cancel_at_period_end=0 WHERE id=?", (user["id"],))
    await db.commit()
    return {"status": "ok", "cancel_at_period_end": False}


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
