import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy import func, select, update

from app.config import get_settings
from app.deps import DB, CurrentUser
from app.models import Notification, NotificationPreference, PushSubscription
from app.schemas import (
    NotificationPage,
    PreferencesIO,
    PushRenewIn,
    PushStatusOut,
    PushSubscriptionDeleteIn,
    PushSubscriptionIn,
    PushTestOut,
)
from app.services import push
from app.services.notifications import SEVERITY, unread_count
from app.services.realtime import enqueue_ws
from app.services.system import audit

router = APIRouter(prefix="/notifications", tags=["notifications"])


def notification_out(n: Notification) -> dict[str, Any]:
    return {
        "id": n.id,
        "type": n.type,
        "severity": n.severity,
        "title": n.title,
        "body": n.body,
        "url": n.url,
        "patient_id": n.patient_id,
        "patient_name": n.patient.full_name if n.patient else None,
        "device_id": n.device_id,
        "dose_id": n.dose_id,
        "read_at": n.read_at,
        "created_at": n.created_at,
        "push_sent": n.push_sent,
        "push_error": n.push_error,
    }


@router.get("", response_model=NotificationPage)
def list_notifications(
    user: CurrentUser,
    db: DB,
    unread_only: bool = False,
    patient_id: int | None = None,
    type: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    q = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        q = q.where(Notification.read_at.is_(None))
    if patient_id is not None:
        q = q.where(Notification.patient_id == patient_id)
    if type:
        q = q.where(Notification.type == type)
    total = db.scalar(select(func.count()).select_from(q.subquery()))
    rows = db.scalars(
        q.order_by(Notification.created_at.desc(), Notification.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).unique()
    return {
        "items": [notification_out(n) for n in rows],
        "total": total,
        "unread": unread_count(db, user.id),
        "page": page,
        "page_size": page_size,
    }


@router.post("/{notification_id}/read", status_code=204)
def mark_read(notification_id: int, user: CurrentUser, db: DB) -> None:
    n = db.get(Notification, notification_id)
    if n is None or n.user_id != user.id:
        raise HTTPException(404, "Notification not found")
    n.read_at = n.read_at or datetime.now(UTC)
    enqueue_ws(db, {user.id}, {"type": "notification_read"})
    db.commit()


@router.post("/read-all", status_code=204)
def mark_all_read(user: CurrentUser, db: DB) -> None:
    db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=datetime.now(UTC))
    )
    enqueue_ws(db, {user.id}, {"type": "notification_read"})
    db.commit()


# ----- Web Push -----


@router.get("/push-status", response_model=PushStatusOut)
def push_status(user: CurrentUser, db: DB) -> dict[str, Any]:
    s = get_settings()
    count = db.scalar(select(func.count()).select_from(PushSubscription).where(PushSubscription.user_id == user.id))
    return {
        "configured": s.push_configured,
        "vapid_public_key": s.vapid_public_key or None,
        "subscriptions": count,
    }


def _upsert_subscription(db: DB, user_id: int, body: PushSubscriptionIn, user_agent: str | None) -> None:
    sub = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint))
    if sub is None:
        sub = PushSubscription(endpoint=body.endpoint)
        db.add(sub)
    sub.user_id = user_id
    sub.p256dh, sub.auth = body.keys.p256dh, body.keys.auth
    sub.expiration_time = datetime.fromtimestamp(body.expirationTime / 1000, UTC) if body.expirationTime else None
    sub.user_agent = (user_agent or "")[:255] or None
    sub.failure_count, sub.last_error = 0, None


@router.post("/push-subscription", status_code=201)
def subscribe(body: PushSubscriptionIn, user: CurrentUser, db: DB, request: Request) -> dict[str, str]:
    if not get_settings().push_configured:
        raise HTTPException(503, "Push notifications are not configured on the server (missing VAPID keys)")
    _upsert_subscription(db, user.id, body, request.headers.get("user-agent"))
    audit(db, "push.subscribe", "push_subscription", user=user, request=request)
    db.commit()
    return {"status": "subscribed"}


@router.delete("/push-subscription", status_code=204)
def unsubscribe(body: PushSubscriptionDeleteIn, user: CurrentUser, db: DB) -> None:
    sub = db.scalar(
        select(PushSubscription).where(PushSubscription.endpoint == body.endpoint, PushSubscription.user_id == user.id)
    )
    if sub is not None:
        db.delete(sub)
        db.commit()


@router.post("/push-subscription/renew", status_code=201)
def renew(body: PushRenewIn, db: DB, request: Request) -> dict[str, str]:
    """Called by the service worker on `pushsubscriptionchange` (no user session there).

    Possession of the old, unguessable endpoint URL authorises moving it to the new one.
    """
    old = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == body.old_endpoint))
    if old is None:
        raise HTTPException(404, "Unknown subscription")
    user_id = old.user_id
    if body.subscription.endpoint != old.endpoint:
        db.delete(old)
        db.flush()
    _upsert_subscription(db, user_id, body.subscription, request.headers.get("user-agent"))
    db.commit()
    return {"status": "renewed"}


@router.post("/test", response_model=PushTestOut)
def send_test(user: CurrentUser, db: DB) -> dict[str, Any]:
    """Send a real push to every browser this user subscribed. Reports actual delivery results."""
    if not get_settings().push_configured:
        raise HTTPException(503, "Push notifications are not configured on the server (missing VAPID keys)")
    if not db.scalar(select(PushSubscription.id).where(PushSubscription.user_id == user.id).limit(1)):
        raise HTTPException(409, "No browser is subscribed to push notifications for this account yet")
    n = Notification(
        user_id=user.id,
        type="test",
        severity=SEVERITY["test"],
        title="🔔 Test notification",
        body="Push notifications are working on this device.",
        url="/settings",
        dedupe_key=f"test:{uuid.uuid4()}",
    )
    db.add(n)
    db.flush()
    sent, errors = push.send_to_user(db, user.id, push.payload_for(n), n.severity)
    n.push_sent = sent
    n.push_error = "; ".join(errors)[:255] if errors else (None if sent else "no push subscriptions")
    enqueue_ws(db, {user.id}, {"type": "notification", "id": n.id, "notification_type": "test"})
    db.commit()
    return {"sent": sent, "failed": len(errors), "errors": errors}


@router.get("/preferences", response_model=PreferencesIO)
def get_preferences(user: CurrentUser, db: DB) -> NotificationPreference:
    prefs = db.get(NotificationPreference, user.id)
    if prefs is None:
        prefs = NotificationPreference(user_id=user.id)
        db.add(prefs)
        db.commit()
    return prefs


@router.put("/preferences", response_model=PreferencesIO)
def update_preferences(body: PreferencesIO, user: CurrentUser, db: DB) -> NotificationPreference:
    prefs = get_preferences(user, db)
    for field, value in body.model_dump().items():
        setattr(prefs, field, value)
    db.commit()
    return prefs
