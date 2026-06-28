import uuid
from fastapi import APIRouter, Depends, HTTPException, Header
from aiosqlite import Connection
from pydantic import BaseModel, EmailStr
from ..database import get_db
from ..services.auth_service import (
    hash_password, verify_password, create_token,
    decode_token, new_user_id, PLANS
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


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
        "SELECT id, email, plan, plan_expires_at, trial_minutes_used, used_day_plan FROM users WHERE id = ?",
        (user_id,)
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="ユーザーが見つかりません")
    return {
        "id": row[0], "email": row[1], "plan": row[2],
        "plan_expires_at": row[3], "trial_minutes_used": row[4],
        "used_day_plan": row[5],
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
    token = create_token(user_id)
    return {"token": token, "email": req.email, "plan": "free"}


@router.post("/login")
async def login(req: LoginRequest, db: Connection = Depends(get_db)):
    cursor = await db.execute(
        "SELECT id, password_hash, plan FROM users WHERE email = ?",
        (req.email.lower(),)
    )
    row = await cursor.fetchone()
    if not row or not verify_password(req.password, row[1]):
        raise HTTPException(status_code=401, detail="メールアドレスまたはパスワードが間違っています")
    token = create_token(row[0])
    return {"token": token, "email": req.email, "plan": row[2]}


@router.get("/me")
async def me(user=Depends(get_current_user)):
    plan_info = PLANS.get(user["plan"], PLANS["free"])
    minutes_left = max(0, plan_info["minutes"] - user["trial_minutes_used"])
    return {
        **user,
        "plan_name": plan_info["name"],
        "minutes_limit": plan_info["minutes"],
        "minutes_left": minutes_left,
        "can_use_discount": bool(user["used_day_plan"]),
    }
