"""Web Push delivery behind a small provider interface (swap for FCM etc. later)."""

import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any, Protocol

from pywebpush import WebPushException, webpush
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import SessionLocal
from app.models import Notification, NotificationPreference, PushSubscription

log = logging.getLogger(__name__)

URGENCY = {"critical": "high", "warning": "high", "success": "normal", "info": "normal"}
ALWAYS_SEND = {"test"}  # categories that preferences cannot switch off


class PushNotConfigured(RuntimeError):
    pass


class PushGone(Exception):
    """The push service says this subscription no longer exists (404/410)."""


class PushProvider(Protocol):
    def send(self, sub: PushSubscription, payload: dict[str, Any], *, urgency: str, ttl: int) -> None: ...


class WebPushProvider:
    def send(self, sub: PushSubscription, payload: dict[str, Any], *, urgency: str, ttl: int) -> None:
        s = get_settings()
        if not s.push_configured:
            raise PushNotConfigured("VAPID keys are not configured on the server")
        try:
            webpush(
                subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                data=json.dumps(payload),
                vapid_private_key=s.vapid_private_key,
                vapid_claims={"sub": s.vapid_subject},
                ttl=ttl,
                headers={"Urgency": urgency},
                timeout=10,
            )
        except WebPushException as exc:
            status = exc.response.status_code if exc.response is not None else None
            if status in (404, 410):
                raise PushGone(str(status)) from exc
            raise RuntimeError(f"push service rejected the message ({status or 'no response'})") from exc


provider: PushProvider = WebPushProvider()
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="push")
# Serverless (Vercel) may freeze background threads once the response is sent, so deliver inline there.
# Tests also flip this to deliver inline.
sync_delivery = bool(os.environ.get("VERCEL"))


def schedule_delivery(notification_id: int) -> None:
    if sync_delivery:
        deliver(notification_id)
    else:
        _executor.submit(_safe_deliver, notification_id)


def _safe_deliver(notification_id: int) -> None:
    try:
        deliver(notification_id)
    except Exception:
        log.exception("push delivery crashed for notification %s", notification_id)


def payload_for(n: Notification) -> dict[str, Any]:
    return {
        "id": n.id,
        "type": n.type,
        "severity": n.severity,
        "title": n.title,
        "body": n.body,
        "url": n.url,
        "tag": n.dedupe_key,
        "timestamp": int(n.created_at.timestamp() * 1000),
    }


def send_to_user(db: Session, user_id: int, payload: dict[str, Any], severity: str) -> tuple[int, list[str]]:
    """Send one payload to every subscription of a user. Returns (sent, errors)."""
    subs = db.scalars(select(PushSubscription).where(PushSubscription.user_id == user_id)).all()
    sent, errors = 0, []
    now = datetime.now(UTC)
    for sub in subs:
        try:
            provider.send(sub, payload, urgency=URGENCY.get(severity, "normal"), ttl=4 * 3600)
        except PushGone:
            db.delete(sub)
            errors.append("expired subscription removed")
        except PushNotConfigured:
            raise
        except Exception as exc:
            sub.failure_count += 1
            sub.last_error = str(exc)[:255]
            errors.append(str(exc)[:255])
        else:
            sent += 1
            sub.last_success_at = now
            sub.failure_count = 0
            sub.last_error = None
    return sent, errors


def deliver(notification_id: int) -> None:
    with SessionLocal() as db:
        n = db.get(Notification, notification_id)
        if n is None:
            return
        prefs = db.get(NotificationPreference, n.user_id)
        if n.type not in ALWAYS_SEND and prefs is not None and not getattr(prefs, n.type, True):
            n.push_error = "disabled in notification preferences"
            db.commit()
            return
        try:
            sent, errors = send_to_user(db, n.user_id, payload_for(n), n.severity)
        except PushNotConfigured as exc:
            n.push_error = str(exc)
        else:
            n.push_sent = sent
            n.push_error = "; ".join(errors)[:255] if errors else (None if sent else "no push subscriptions")
        db.commit()
