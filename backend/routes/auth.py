import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, Header, Request
from aiosqlite import Connection
from pydantic import BaseModel, EmailStr
from database import get_db
from services.auth_service import (
    hash_password, verify_password, create_token,
    decode_token, decode_token_payload, new_user_id, PLANS
)

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")

# 無料プラン悪用対策：同一IPからの新規登録数を24時間あたりこの件数までに制限する
# 大学Wi-Fi・キャリアCGNAT等で多数の正規ユーザーが同一IPを共有するケースを潰さないよう、
# 「1人が使い捨てメールで無限に量産する」ケースだけを止められる水準に余裕を持たせている
REGISTER_IP_LIMIT_PER_DAY = 20

router = APIRouter(prefix="/api/auth", tags=["auth"])

# オーバーレイ用トークン共有（ChromeとElectronのlocalStorageが別のため）
_overlay_token: str | None = None


def _client_ip(request: Request) -> str:
    """Render等のプロキシ配下ではX-Forwarded-Forの先頭がクライアントの実IP"""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def _carried_over_free_minutes(db: Connection, device_id: str | None) -> int:
    """同一端末（device_id）が過去に使った無料枠の合計を返す。
    新しいアカウントで登録し直しても、この端末が無料枠を使い切っていれば
    最初から0分しか残っていない状態にし、使い回しを防ぐ"""
    if not device_id:
        return 0
    cursor = await db.execute(
        "SELECT COALESCE(SUM(trial_minutes_used), 0) FROM users WHERE device_id = ? AND plan = 'free'",
        (device_id,)
    )
    row = await cursor.fetchone()
    used = row[0] if row else 0
    return min(used, PLANS["free"]["minutes"])


class RegisterRequest(BaseModel):
    email: str
    password: str
    device_id: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


async def get_current_user(
    authorization: str | None = Header(None),
    db: Connection = Depends(get_db),
):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="認証が必要です")
    token = authorization.split(" ", 1)[1]
    user_id = decode_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="トークンが無効です")
    cursor = await db.execute(
        "SELECT id, email, plan, plan_expires_at, trial_minutes_used, used_day_plan, is_admin, "
        "stripe_customer_id, stripe_subscription_id, subscription_status, cancel_at_period_end "
        "FROM users WHERE id = ?",
        (user_id,)
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="ユーザーが見つかりません")

    plan = row[2]
    plan_expires_at = row[3]

    # 有料プランの期限切れ自動ダウングレード
    if plan != "free" and plan_expires_at:
        from datetime import datetime, timezone
        try:
            expires = datetime.fromisoformat(plan_expires_at.replace("Z", "+00:00"))
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) > expires:
                plan = "free"
                await db.execute("UPDATE users SET plan = 'free' WHERE id = ?", (user_id,))
                await db.commit()
        except Exception:
            pass

    return {
        "id": row[0], "email": row[1], "plan": plan,
        "plan_expires_at": plan_expires_at, "trial_minutes_used": row[4],
        "used_day_plan": row[5], "is_admin": bool(row[6]),
        "stripe_customer_id": row[7], "stripe_subscription_id": row[8],
        "subscription_status": row[9], "cancel_at_period_end": bool(row[10]),
    }


@router.post("/register")
async def register(req: RegisterRequest, request: Request, db: Connection = Depends(get_db)):
    cursor = await db.execute("SELECT id FROM users WHERE email = ?", (req.email,))
    if await cursor.fetchone():
        raise HTTPException(status_code=400, detail="このメールアドレスは既に登録されています")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="パスワードは6文字以上にしてください")

    # 無料プラン悪用対策：同一IPからの登録数を24時間あたり REGISTER_IP_LIMIT_PER_DAY 件までに制限
    ip = _client_ip(request)
    cursor = await db.execute(
        "SELECT COUNT(*) FROM users WHERE registration_ip = ? AND created_at > datetime('now', '-1 day')",
        (ip,)
    )
    row = await cursor.fetchone()
    if row and row[0] >= REGISTER_IP_LIMIT_PER_DAY:
        raise HTTPException(
            status_code=429,
            detail="このネットワークからの新規登録が上限に達しました。しばらく時間をおいてから再度お試しください"
        )

    # 無料プラン悪用対策：同一端末が過去に使った無料枠を新アカウントにも引き継ぐ（使い回し防止）
    carried_over_minutes = await _carried_over_free_minutes(db, req.device_id)

    user_id = new_user_id()
    await db.execute(
        "INSERT INTO users (id, email, password_hash, registration_ip, device_id, trial_minutes_used) VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, req.email.lower(), hash_password(req.password), ip, req.device_id, carried_over_minutes)
    )
    await db.commit()
    token = create_token(user_id, is_admin=False)
    return {"token": token, "email": req.email, "plan": "free", "is_admin": False}


@router.post("/login")
async def login(req: LoginRequest, db: Connection = Depends(get_db)):
    cursor = await db.execute(
        "SELECT id, password_hash, plan, is_admin FROM users WHERE email = ?",
        (req.email.lower(),)
    )
    row = await cursor.fetchone()
    if not row or not verify_password(req.password, row[1]):
        raise HTTPException(status_code=401, detail="メールアドレスまたはパスワードが間違っています")
    is_admin = bool(row[3])
    token = create_token(row[0], is_admin=is_admin)
    return {"token": token, "email": req.email, "plan": row[2], "is_admin": is_admin}


@router.get("/me")
async def me(user=Depends(get_current_user)):
    plan_info = PLANS.get(user["plan"], PLANS["free"])
    # 管理者は時間制限なし（無制限として扱う）
    if user["is_admin"]:
        minutes_left = 99999
        minutes_limit = 99999
    else:
        minutes_left = max(0, plan_info["minutes"] - user["trial_minutes_used"])
        minutes_limit = plan_info["minutes"]
    return {
        **user,
        "plan_name": plan_info["name"],
        "minutes_limit": minutes_limit,
        "minutes_left": minutes_left,
        "can_use_discount": bool(user["used_day_plan"]),
    }


class SyncTokenRequest(BaseModel):
    token: str


@router.post("/sync-token")
async def sync_token(req: SyncTokenRequest):
    """ChromeのlocalStorageトークンをバックエンド経由でオーバーレイへ共有"""
    global _overlay_token
    _overlay_token = req.token
    return {"ok": True}


@router.get("/overlay-token")
async def get_overlay_token():
    """オーバーレイがトークンを取得するエンドポイント"""
    return {"token": _overlay_token}


class GoogleAuthRequest(BaseModel):
    id_token: str
    device_id: str | None = None


@router.post("/google")
async def google_login(body: GoogleAuthRequest, db: Connection = Depends(get_db)):
    """Google Sign-In IDトークンを検証してJWTを発行する"""
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Googleログインが設定されていません（GOOGLE_CLIENT_IDが未設定）")

    try:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests
        idinfo = google_id_token.verify_oauth2_token(
            body.id_token,
            google_requests.Request(),
            GOOGLE_CLIENT_ID,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Googleトークンが無効です: {e}")

    google_id = idinfo["sub"]
    email = idinfo["email"].lower()
    name = idinfo.get("name", "")

    # google_id で既存ユーザーを検索
    cursor = await db.execute("SELECT id, is_admin, plan FROM users WHERE google_id = ?", (google_id,))
    row = await cursor.fetchone()
    if row:
        token = create_token(row[0], is_admin=bool(row[2]))
        return {"token": token, "email": email, "plan": row[2], "is_admin": bool(row[2])}

    # 同メールのメール登録ユーザーがいれば google_id を紐付け
    cursor = await db.execute("SELECT id, is_admin, plan FROM users WHERE email = ?", (email,))
    row = await cursor.fetchone()
    if row:
        await db.execute("UPDATE users SET google_id = ? WHERE id = ?", (google_id, row[0]))
        await db.commit()
        token = create_token(row[0], is_admin=bool(row[2]))
        return {"token": token, "email": email, "plan": row[2], "is_admin": bool(row[2])}

    # 新規ユーザー作成（Googleログインはパスワードなし → 空文字でNOT NULL制約を満たす）
    # 無料プラン悪用対策：同一端末が過去に使った無料枠を新アカウントにも引き継ぐ
    carried_over_minutes = await _carried_over_free_minutes(db, body.device_id)
    user_id = new_user_id()
    await db.execute(
        "INSERT INTO users (id, email, password_hash, google_id, device_id, trial_minutes_used) VALUES (?, ?, '', ?, ?, ?)",
        (user_id, email, google_id, body.device_id, carried_over_minutes)
    )
    await db.commit()
    token = create_token(user_id, is_admin=False)
    return {"token": token, "email": email, "plan": "free", "is_admin": False}
