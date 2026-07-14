import os
import uuid
import bcrypt
from datetime import datetime, timedelta
from jose import jwt, JWTError
from dotenv import load_dotenv

load_dotenv()

# JWTの署名鍵。2026-07-14、品質管理部の独立レビューで発見した「本番が公開デフォルト鍵で
# 署名している疑い」への対応。
#
# 修正前は os.getenv("JWT_SECRET", "interview-assistant-secret-change-in-prod") で、
# JWT_SECRETが未設定なら**このソースに書かれた文字列**で署名していた。render.yamlは
# SECRET_KEYしか定義しておらずJWT_SECRETが無いため、本番はこの公開値で署名していた可能性が高い。
# 公開値で署名しているということは、**誰でも任意のユーザーになりすますトークンを作れる**。
#
# 対策：
#   1. JWT_SECRET があればそれを使う（render.yamlにgenerateValue: trueで追加した）
#   2. 無ければ SECRET_KEY（Renderが生成するランダム値）にフォールバックする
#   3. どちらも無い場合のみ、開発用のローカル鍵を使う。ただし本番（RENDER環境変数あり）で
#      両方欠けていたら**起動時に落とす**。公開鍵で決済ライブのサービスを動かし続ける方が、
#      起動しないことよりはるかに危険なため、ここは fail-close にする
#      （「安全装置は本体を止めない形で作る」の例外。判断根拠は取得できており、
#        “鍵が無い”という結論自体が確定しているので、迷って止まるケースではない）
_DEV_FALLBACK_SECRET = "interview-assistant-dev-only-not-for-production"
SECRET_KEY = os.getenv("JWT_SECRET") or os.getenv("SECRET_KEY") or ""
if not SECRET_KEY:
    if os.getenv("RENDER"):  # Renderの実行環境では必ず定義される
        raise RuntimeError(
            "JWT_SECRET も SECRET_KEY も設定されていません。"
            "この状態で起動すると公開値でトークンを署名することになり、"
            "誰でも他人になりすませます。Renderの環境変数に JWT_SECRET を設定してください。"
        )
    SECRET_KEY = _DEV_FALLBACK_SECRET

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


def create_token(user_id: str, is_admin: bool = False) -> str:
    expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    return jwt.encode(
        {"sub": user_id, "exp": expire, "is_admin": is_admin},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def decode_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None


def decode_token_payload(token: str) -> dict | None:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None


def new_user_id() -> str:
    return str(uuid.uuid4())
