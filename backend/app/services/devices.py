"""Device connectivity, heartbeats and ingestion of the hardware event contract."""

from datetime import datetime, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Device, MedicineEvent, SystemConfig
from app.schemas import DeviceEventIn, HeartbeatIn
from app.services import doses
from app.services.notifications import notify_device, notify_dose
from app.services.realtime import enqueue_ws

HEARTBEAT_INTERVAL_SECONDS = 60
MAX_CLOCK_SKEW = timedelta(minutes=10)
MAX_EVENT_AGE = timedelta(days=7)


def status_of(d: Device, cfg: SystemConfig, now: datetime) -> str:
    if d.reported_state == "error":
        return "error"
    if d.reported_state == "offline" or d.offline_since is not None:
        return "offline"
    if d.last_seen_at is None:
        return "unregistered"
    age = now - d.last_seen_at
    if age >= timedelta(minutes=cfg.device_offline_after_minutes):
        return "offline"
    if age >= timedelta(minutes=cfg.device_warning_after_minutes):
        return "warning"
    return "online"


def brief(d: Device, cfg: SystemConfig, now: datetime) -> dict[str, Any]:
    return {
        "id": d.id,
        "device_uid": d.device_uid,
        "name": d.name,
        "status": status_of(d, cfg, now),
        "last_seen_at": d.last_seen_at,
    }


def device_out(d: Device, cfg: SystemConfig, now: datetime, owner_name: str) -> dict[str, Any]:
    return {
        **brief(d, cfg, now),
        "patient": {"id": d.patient.id, "full_name": d.patient.full_name} if d.patient else None,
        "owner": {"id": d.owner_id, "full_name": owner_name},
        "firmware_version": d.firmware_version,
        "signal_strength": d.signal_strength,
        "last_error": d.last_error,
        "offline_since": d.offline_since,
        "is_active": d.is_active,
        "created_at": d.created_at,
    }


def _changed(db: Session, d: Device) -> None:
    enqueue_ws(db, doses.recipients(d.patient, d), {"type": "device", "device_uid": d.device_uid})


def _restore(db: Session, d: Device, now: datetime) -> None:
    if d.reported_state == "offline":
        d.reported_state = None
    if d.offline_since is not None:
        episode = d.offline_since.isoformat()
        d.offline_since = None
        doses.record_event(
            db,
            key=f"server:device:{d.id}:online:{episode}",
            event_id=f"device-{d.id}-online",
            source="server",
            event_type="device_online",
            event_time=now,
            patient=d.patient,
            device=d,
        )
        notify_device(db, d, "device_online", episode)


def _go_offline(db: Session, d: Device, now: datetime, source: str) -> None:
    if d.offline_since is not None:
        return
    d.offline_since = now
    episode = now.isoformat()
    if source == "server":
        doses.record_event(
            db,
            key=f"server:device:{d.id}:offline:{episode}",
            event_id=f"device-{d.id}-offline",
            source="server",
            event_type="device_offline",
            event_time=now,
            patient=d.patient,
            device=d,
        )
    notify_device(db, d, "device_offline", episode)


def _report_error(db: Session, d: Device, error: str | None, episode: str) -> None:
    d.reported_state = "error"
    d.last_error = (error or "Unspecified device error")[:200]
    notify_device(db, d, "device_error", episode)


def heartbeat(db: Session, d: Device, body: HeartbeatIn, now: datetime) -> None:
    d.last_seen_at = now
    if body.firmware_version:
        d.firmware_version = body.firmware_version
    if body.signal_strength is not None:
        d.signal_strength = body.signal_strength
    if body.status == "error":
        if d.reported_state != "error":
            _report_error(db, d, body.error, now.isoformat())
    elif d.reported_state == "error":
        d.reported_state = None
    _restore(db, d, now)
    _changed(db, d)


def check_offline(db: Session, now: datetime, cfg: SystemConfig) -> None:
    """Scheduler step: alert once per outage when heartbeats stop."""
    stale = db.scalars(
        select(Device)
        .where(
            Device.is_active,
            Device.offline_since.is_(None),
            Device.last_seen_at < now - timedelta(minutes=cfg.device_offline_after_minutes),
        )
        .with_for_update(of=Device, skip_locked=True)
    ).all()
    for d in stale:
        _go_offline(db, d, now, "server")
        _changed(db, d)


EVENT_STATUS = {
    "medicine_due": "due",
    "medicine_dispensed": "dispensed",
    "medicine_taken": "taken",
    "medicine_missed": "missed",
}


def ingest_event(
    db: Session, d: Device, body: DeviceEventIn, now: datetime, cfg: SystemConfig
) -> tuple[MedicineEvent, bool]:
    """Store and apply one device event. Returns (event, duplicate)."""
    key = f"{d.device_uid}:{body.event_id}"
    existing = db.scalar(select(MedicineEvent).where(MedicineEvent.idempotency_key == key))
    if existing is not None:
        return existing, True

    at = body.event_time or now
    if at > now + MAX_CLOCK_SKEW:
        raise HTTPException(422, "event_time is in the future; check the device clock")
    if at < now - MAX_EVENT_AGE:
        raise HTTPException(422, "event_time is older than 7 days")
    patient = d.patient
    is_medicine = body.event_type in EVENT_STATUS
    if is_medicine and (patient is None or not patient.is_active):
        raise HTTPException(409, "Device is not assigned to an active patient")

    event = doses.record_event(
        db,
        key=key,
        event_id=body.event_id,
        source="device",
        event_type=body.event_type,
        event_time=at,
        patient=patient,
        device=d,
        meta=body.metadata,
    )
    if event is None:  # lost a race with an identical retry
        return db.scalar(select(MedicineEvent).where(MedicineEvent.idempotency_key == key)), True

    if body.event_type != "device_offline":
        d.last_seen_at = now

    if is_medicine:
        status = EVENT_STATUS[body.event_type]
        dose = doses.resolve_dose(
            db,
            patient,
            status,
            at,
            dose_id=body.dose_id,
            schedule_id=body.schedule_id,
            medicine_id=body.medicine_id,
            slot=body.metadata.get("slot"),
        )
        event.dose = dose
        if dose is None:
            event.result, event.detail = "unmatched", "No matching scheduled dose for this event"
        elif doses.transition(db, dose, status, at, cfg, device=d):
            notify_dose(db, dose, body.event_type)
        else:
            event.result, event.detail = "ignored", f"Dose is already {dose.status}"
    elif body.event_type == "device_online":
        _restore(db, d, now)
    elif body.event_type == "device_offline":
        d.reported_state = "offline"
        _go_offline(db, d, now, "device")
    elif body.event_type == "device_error":
        _report_error(db, d, str(body.metadata.get("error") or "") or None, key)
    _changed(db, d)
    db.flush()
    return event, False
