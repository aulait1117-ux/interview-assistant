import os
import uuid
import bcrypt
from datetime import datetime, timedelta
from jose import jwt, JWTError
from dotenv import load_dotenv

load_dotenv()

SECRET_KEY = os.getenv("JWT_SECRET", "interview-assistant-secret-change-in-prod")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24 * 7  # 1週間

PLANS = {
    "free":    {"name": "無料",       "price": 0,    "minutes": 30},
    "day1h":   {"name": "1日1時間",   "price": 500,  "minutes": 60},
    "day24h":  {"name": "1日使い放題", "price": 1000, "minutes": 60 * 24},
    "monthly": {"name": "月額使い放題", "price": 2000, "minutes": 60 * 24 * 31},
    "monthly_discount": {"name": "月額（割引）", "price": 1000, "minutes": 60 * 24 * 31},
}


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_token(user_id: str) -> str:
    expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    return jwt.encode({"sub": user_id, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None


def new_user_id() -> str:
    return str(uuid.uuid4())
