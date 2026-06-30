import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, Header
from aiosqlite import Connection
from pydantic import BaseModel, EmailStr
from database import get_db
from services.auth_service import (
    hash_password, verify_password, create_token,
    decode_token, decode_token_payload, new_user_id, PLANS
)

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")

router = APIRouter(prefix="/api/auth", tags=["auth"])

# オーバーレイ用トークン共有（ChromeとElectronのlocalStorageが別のため）
_overlay_token: str | None = None


class RegisterRequest(BaseModel):
    email: str
    password: str


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
        "SELECT id, email, plan, plan_expires_at, trial_minutes_used, used_day_plan, is_admin FROM users WHERE id = ?",
        (user_id,)
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="ユーザーが見つかりません")
    return {
        "id": row[0], "email": row[1], "plan": row[2],
        "plan_expires_at": row[3], "trial_minutes_used": row[4],
        "used_day_plan": row[5], "is_admin": bool(row[6]),
    }


@router.post("/register")
async def register(req: RegisterRequest, db: Connection = Depends(get_db)):
    cursor = await db.execute("SELECT id FROM users WHERE email = ?", (req.email,))
    if await cursor.fetchone():
        raise HTTPException(status_code=400, detail="このメールアドレスは既に登録されています")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="パスワードは6文字以上にしてください")
    user_id = new_user_id()
    await db.execute(
        "INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)",
        (user_id, req.email.lower(), hash_password(req.password))
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

    # 新規ユーザー作成（password_hash はNULL）
    user_id = new_user_id()
    await db.execute(
        "INSERT INTO users (id, email, password_hash, google_id) VALUES (?, ?, NULL, ?)",
        (user_id, email, google_id)
    )
    await db.commit()
    token = create_token(user_id, is_admin=False)
    return {"token": token, "email": email, "plan": "free", "is_admin": False}
