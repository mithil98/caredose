"""FastAPI dependencies: current user, roles, device authentication, rate limiting."""

import threading
import time
from collections import defaultdict, deque
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Device, User
from app.services.auth import decode_token, device_key_matches

DB = Annotated[Session, Depends(get_db)]
_bearer = HTTPBearer(auto_error=False)


def current_user(db: DB, creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]) -> User:
    user_id = decode_token(creds.credentials, "access") if creds else None
    user = db.get(User, user_id) if user_id else None
    if user is None or not user.is_active:
        raise HTTPException(401, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    return user


CurrentUser = Annotated[User, Depends(current_user)]


def require_admin(user: CurrentUser) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Administrator access required")
    return user


AdminUser = Annotated[User, Depends(require_admin)]


def load_device(db: Session, device_uid: str, key: str | None) -> Device:
    """Devices authenticate with their own key (X-Device-Key), never with a user token."""
    device = db.scalar(select(Device).where(Device.device_uid == device_uid.upper()))
    if device is None or not key or not device_key_matches(key, device.key_hash):
        raise HTTPException(401, "Invalid device credentials")
    if not device.is_active:
        raise HTTPException(403, "Device is deactivated")
    return device


DeviceKey = Annotated[str | None, Header(alias="X-Device-Key")]


def authenticated_device(device_id: str, db: DB, x_device_key: DeviceKey = None) -> Device:
    return load_device(db, device_id, x_device_key)


class RateLimit:
    """Sliding-window limiter keyed by client IP + route."""

    # ponytail: per-process memory; move to Redis when running several backend replicas.
    def __init__(self, limit: int, seconds: int) -> None:
        self.limit, self.seconds = limit, seconds
        self.hits: dict[str, deque[float]] = defaultdict(deque)
        self.lock = threading.Lock()

    def __call__(self, request: Request) -> None:
        key = f"{request.client.host if request.client else '?'}:{request.url.path}"
        now = time.monotonic()
        with self.lock:
            q = self.hits[key]
            while q and q[0] <= now - self.seconds:
                q.popleft()
            if len(q) >= self.limit:
                retry = int(self.seconds - (now - q[0])) + 1
                raise HTTPException(429, "Too many requests, slow down", headers={"Retry-After": str(retry)})
            q.append(now)

    def reset(self) -> None:
        with self.lock:
            self.hits.clear()


auth_limit = RateLimit(10, 60)
refresh_limit = RateLimit(30, 60)
device_limit = RateLimit(120, 60)
