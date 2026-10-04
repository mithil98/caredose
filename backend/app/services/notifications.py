"""Creates in-app notifications (deduplicated) and queues WebSocket + push delivery."""

from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import Device, MedicineDose, Notification, Patient
from app.services.realtime import enqueue_push, enqueue_ws

SEVERITY = {
    "medicine_due": "warning",
    "medicine_dispensed": "info",
    "medicine_taken": "success",
    "medicine_missed": "critical",
    "device_offline": "critical",
    "device_online": "success",
    "device_error": "critical",
    "test": "info",
}


def notify(
    db: Session,
    *,
    user_id: int,
    type: str,
    title: str,
    body: str,
    url: str,
    dedupe_key: str,
    patient_id: int | None = None,
    device_id: int | None = None,
    dose_id: int | None = None,
) -> int | None:
    """Insert a notification unless one with the same dedupe key exists. Returns its id or None."""
    nid = db.scalar(
        pg_insert(Notification)
        .values(
            user_id=user_id,
            type=type,
            severity=SEVERITY[type],
            title=title,
            body=body,
            url=url,
            dedupe_key=dedupe_key,
            patient_id=patient_id,
            device_id=device_id,
            dose_id=dose_id,
        )
        .on_conflict_do_nothing(constraint="uq_notification_dedupe")
        .returning(Notification.id)
    )
    if nid is None:
        return None
    enqueue_ws(
        db,
        {user_id},
        {
            "type": "notification",
            "id": nid,
            "notification_type": type,
            "severity": SEVERITY[type],
            "title": title,
            "body": body,
            "url": url,
        },
    )
    enqueue_push(db, nid)
    return nid


def _clock(at: datetime, tz: str) -> str:
    return at.astimezone(ZoneInfo(tz)).strftime("%I:%M %p").lstrip("0")


NO_PLURAL = {"ml", "mg", "mcg", "g", "iu"}


def _qty(dose: MedicineDose) -> str:
    q = dose.dose_quantity.normalize()
    unit = dose.dose_unit
    if q != 1 and not unit.endswith("s") and unit.lower() not in NO_PLURAL:
        unit += "s"
    return f"{q:f} {unit}"


def notify_dose(db: Session, dose: MedicineDose, kind: str) -> int | None:
    p = dose.patient
    name, period = p.full_name, dose.period
    medicine = f"Medicine: {dose.medicine_name} · Dose: {_qty(dose)}"
    if kind == "medicine_due":
        title, body = "💊 Medicine Due", f"{name}'s {period} medicine is due now.\n{medicine}"
    elif kind == "medicine_dispensed":
        at = _clock(dose.dispensed_at, p.timezone)
        title, body = "💊 Medicine Dispensed", f"{name}'s {period} medicine was dispensed at {at}.\n{medicine}"
    elif kind == "medicine_taken":
        at = _clock(dose.taken_at, p.timezone)
        late = " (late)" if dose.is_late else ""
        title, body = "✅ Medicine Taken", f"{name}'s {period} dose was confirmed at {at}{late}.\n{medicine}"
    elif kind == "medicine_missed":
        title, body = "⚠️ Medicine Missed", f"{name}'s {period} dose has not been confirmed.\n{medicine}"
    else:
        raise ValueError(kind)
    return notify(
        db,
        user_id=p.caretaker_id,
        type=kind,
        title=title,
        body=body,
        url=f"/patients/{p.id}?dose={dose.id}",
        dedupe_key=f"dose:{dose.id}:{kind}",
        patient_id=p.id,
        dose_id=dose.id,
    )


def notify_device(db: Session, device: Device, kind: str, episode: str) -> int | None:
    patient: Patient | None = device.patient
    who = f" ({patient.full_name})" if patient else ""
    if kind == "device_offline":
        title = "🔴 Device Offline"
        body = f"Medicine device {device.device_uid}{who} has not communicated with the server."
    elif kind == "device_online":
        title, body = "🟢 Device Online", f"Medicine device {device.device_uid}{who} is connected again."
    elif kind == "device_error":
        title = "🛠️ Device Error"
        body = f"Medicine device {device.device_uid}{who} reported a problem: {device.last_error or 'unknown error'}."
    else:
        raise ValueError(kind)
    return notify(
        db,
        user_id=device.owner_id,
        type=kind,
        title=title,
        body=body,
        url=f"/devices/{device.device_uid}",
        dedupe_key=f"device:{device.id}:{kind}:{episode}",
        patient_id=device.patient_id,
        device_id=device.id,
    )


def unread_count(db: Session, user_id: int) -> int:
    return db.scalar(
        select(func.count())
        .select_from(Notification)
        .where(Notification.user_id == user_id, Notification.read_at.is_(None))
    )
