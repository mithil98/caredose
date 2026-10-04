"""Admin-only: caretaker accounts, system health, audit log, engine configuration."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy import func, select, text

from app.config import get_settings
from app.deps import DB, AdminUser
from app.models import AuditLog, Device, MedicineEvent, Notification, Patient, PushSubscription, User
from app.schemas import (
    AdminUserCreateIn,
    AdminUserOut,
    AdminUserUpdateIn,
    AuditOut,
    HealthOut,
    Page,
    SystemConfigIO,
    build,
)
from app.services import devices
from app.services.auth import create_user, hash_password
from app.services.realtime import hub
from app.services.system import audit, get_config
from app.workers.scheduler import state as scheduler_state

router = APIRouter(prefix="/admin", tags=["admin"])


def _users_out(db: DB, users: list[User]) -> list[AdminUserOut]:
    ids = [u.id for u in users]
    pc = dict(
        db.execute(
            select(Patient.caretaker_id, func.count())
            .where(Patient.caretaker_id.in_(ids))
            .group_by(Patient.caretaker_id)
        ).all()
    )
    dc = dict(
        db.execute(
            select(Device.owner_id, func.count()).where(Device.owner_id.in_(ids)).group_by(Device.owner_id)
        ).all()
    )
    return [build(AdminUserOut, u, patient_count=pc.get(u.id, 0), device_count=dc.get(u.id, 0)) for u in users]


@router.get("/users", response_model=list[AdminUserOut])
def list_users(_: AdminUser, db: DB) -> list[AdminUserOut]:
    return _users_out(db, list(db.scalars(select(User).order_by(User.role, User.full_name))))


@router.post("/users", response_model=AdminUserOut, status_code=201)
def create_account(body: AdminUserCreateIn, admin: AdminUser, db: DB, request: Request) -> AdminUserOut:
    if db.scalar(select(User.id).where(User.email == body.email.lower())):
        raise HTTPException(409, "An account with this email already exists")
    user = create_user(
        db,
        email=body.email,
        password=body.password,
        full_name=body.full_name,
        role=body.role,
        timezone=body.timezone,
    )
    audit(db, "user.create", "user", user.id, user=admin, request=request, role=body.role)
    db.commit()
    return _users_out(db, [user])[0]


@router.put("/users/{user_id}", response_model=AdminUserOut)
def update_account(user_id: int, body: AdminUserUpdateIn, admin: AdminUser, db: DB, request: Request) -> AdminUserOut:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "User not found")
    if user.id == admin.id and (body.is_active is False or body.role == "caretaker"):
        raise HTTPException(422, "You cannot deactivate or demote your own account")
    changes = body.model_dump(exclude_none=True, exclude={"password"})
    for field, value in changes.items():
        setattr(user, field, value)
    if body.password:
        user.password_hash = hash_password(body.password)
        changes["password"] = "reset"
    audit(db, "user.update", "user", user.id, user=admin, request=request, fields=sorted(changes))
    db.commit()
    return _users_out(db, [user])[0]


@router.get("/audit-logs", response_model=Page[AuditOut])
def audit_logs(
    _: AdminUser,
    db: DB,
    action: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    q = select(AuditLog)
    if action:
        q = q.where(AuditLog.action.startswith(action))
    total = db.scalar(select(func.count()).select_from(q.subquery()))
    rows = db.scalars(q.order_by(AuditLog.id.desc()).offset((page - 1) * page_size).limit(page_size)).unique()
    return {
        "items": [
            {
                "id": a.id,
                "actor_email": a.actor.email if a.actor else None,
                "actor_device_id": a.actor_device_id,
                "action": a.action,
                "entity_type": a.entity_type,
                "entity_id": a.entity_id,
                "details": a.details,
                "ip": a.ip,
                "created_at": a.created_at,
            }
            for a in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/config", response_model=SystemConfigIO)
def read_config(_: AdminUser, db: DB) -> Any:
    cfg = get_config(db)
    db.commit()
    return cfg


@router.put("/config", response_model=SystemConfigIO)
def update_config(body: SystemConfigIO, admin: AdminUser, db: DB, request: Request) -> Any:
    cfg = get_config(db)
    for field, value in body.model_dump().items():
        setattr(cfg, field, value)
    audit(db, "config.update", "system_config", 1, user=admin, request=request, **body.model_dump())
    db.commit()
    return cfg


@router.get("/health", response_model=HealthOut)
def health(_: AdminUser, db: DB) -> dict[str, Any]:
    now = datetime.now(UTC)
    cfg = get_config(db)
    db_ok = db.scalar(text("SELECT 1")) == 1
    statuses: dict[str, int] = {}
    for d in db.scalars(select(Device).where(Device.is_active)):
        s = devices.status_of(d, cfg, now)
        statuses[s] = statuses.get(s, 0) + 1
    last_tick = scheduler_state["last_tick_at"]
    interval = get_settings().scheduler_interval_seconds
    scheduler_ok = (
        bool(scheduler_state["running"]) and last_tick is not None and now - last_tick < timedelta(seconds=interval * 3)
    )
    day_ago = now - timedelta(hours=24)

    def count(model: Any, *where: Any) -> int:
        return db.scalar(select(func.count()).select_from(model).where(*where))

    return {
        "status": "ok" if db_ok and scheduler_ok else "degraded",
        "database": db_ok,
        "scheduler_running": scheduler_ok,
        "scheduler_last_tick_at": last_tick,
        "push_configured": get_settings().push_configured,
        "websocket_connections": hub.connection_count,
        "users": count(User),
        "patients": count(Patient),
        "devices": statuses,
        "push_subscriptions": count(PushSubscription),
        "notifications_24h": count(Notification, Notification.created_at >= day_ago),
        "events_24h": count(MedicineEvent, MedicineEvent.received_at >= day_ago),
    }
