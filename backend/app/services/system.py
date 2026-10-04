"""System configuration, audit logging and authorization scoping helpers."""

from typing import Any

from fastapi import HTTPException, Request
from sqlalchemy import Select, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import AuditLog, Device, Patient, SystemConfig, User


def get_config(db: Session) -> SystemConfig:
    cfg = db.get(SystemConfig, 1)
    if cfg is None:
        s = get_settings()
        db.execute(
            pg_insert(SystemConfig)
            .values(
                id=1,
                missed_dose_timeout_minutes=s.missed_dose_timeout_minutes,
                late_dose_after_minutes=s.late_dose_after_minutes,
                device_warning_after_minutes=s.device_warning_after_minutes,
                device_offline_after_minutes=s.device_offline_after_minutes,
            )
            .on_conflict_do_nothing()
        )
        cfg = db.get(SystemConfig, 1)
    return cfg


def audit(
    db: Session,
    action: str,
    entity_type: str,
    entity_id: Any = None,
    *,
    user: User | None = None,
    device: Device | None = None,
    request: Request | None = None,
    **details: Any,
) -> None:
    """Record who did what. Never pass patient names or other personal details here."""
    db.add(
        AuditLog(
            actor_user_id=user.id if user else None,
            actor_device_id=device.id if device else None,
            action=action,
            entity_type=entity_type,
            entity_id=None if entity_id is None else str(entity_id),
            details=details,
            ip=request.client.host if request and request.client else None,
        )
    )


def patients_query(user: User) -> Select[tuple[Patient]]:
    q = select(Patient)
    return q if user.role == "admin" else q.where(Patient.caretaker_id == user.id)


def get_patient(db: Session, user: User, patient_id: int) -> Patient:
    """Load a patient the user may access. 404 (not 403) so ids cannot be probed."""
    patient = db.get(Patient, patient_id)
    if patient is None or (user.role != "admin" and patient.caretaker_id != user.id):
        raise HTTPException(404, "Patient not found")
    return patient


def devices_query(user: User) -> Select[tuple[Device]]:
    q = select(Device)
    return q if user.role == "admin" else q.where(Device.owner_id == user.id)


def get_device(db: Session, user: User, device_uid: str) -> Device:
    device = db.scalar(select(Device).where(Device.device_uid == device_uid.upper()))
    if device is None or (user.role != "admin" and device.owner_id != user.id):
        raise HTTPException(404, "Device not found")
    return device
