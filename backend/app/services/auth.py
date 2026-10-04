"""Password hashing, JWTs and device-key hashing."""

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import NotificationPreference, User

_hasher = PasswordHasher()
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def create_token(user: User, kind: str) -> str:
    s = get_settings()
    lifetime = (
        timedelta(minutes=s.jwt_access_token_expire_minutes)
        if kind == "access"
        else timedelta(days=s.jwt_refresh_token_expire_days)
    )
    now = datetime.now(UTC)
    claims = {"sub": str(user.id), "role": user.role, "type": kind, "iat": now, "exp": now + lifetime}
    return jwt.encode(claims, s.jwt_secret, algorithm=ALGORITHM)


def decode_token(token: str, kind: str) -> int | None:
    """Return the user id for a valid token of the given kind, else None."""
    try:
        claims = jwt.decode(token, get_settings().jwt_secret, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None
    if claims.get("type") != kind:
        return None
    try:
        return int(claims["sub"])
    except (KeyError, ValueError):
        return None


def authenticate(db: Session, email: str, password: str) -> User | None:
    user = db.scalar(select(User).where(User.email == email.lower()))
    if user is None:
        # Spend the same time hashing so response timing does not reveal valid emails.
        verify_password(password, _DUMMY_HASH)
        return None
    if not user.is_active or not verify_password(password, user.password_hash):
        return None
    return user


def create_user(db: Session, *, email: str, password: str, full_name: str, role: str, timezone: str) -> User:
    user = User(
        email=email.lower(),
        password_hash=hash_password(password),
        full_name=full_name,
        role=role,
        timezone=timezone,
    )
    db.add(user)
    db.flush()
    db.add(NotificationPreference(user_id=user.id))
    return user


def new_device_key() -> str:
    return "dk_" + secrets.token_urlsafe(32)


def hash_device_key(key: str) -> str:
    return hmac.new(get_settings().device_api_secret.encode(), key.encode(), hashlib.sha256).hexdigest()


def device_key_matches(key: str, key_hash: str) -> bool:
    return hmac.compare_digest(hash_device_key(key), key_hash)


_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))
