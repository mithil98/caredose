"""Medicine dose engine: materializes schedules into doses and owns the dose state machine.

    SCHEDULED -> DUE -> DISPENSED -> TAKEN
    SCHEDULED -> DUE -> MISSED (-> TAKEN, flagged late, if confirmed afterwards)
    SCHEDULED/DUE -> CANCELLED (caretaker)

All transitions go through `transition()`; the backend decides, never the browser.
"""

from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import (
    PERIODS,
    Device,
    Medicine,
    MedicineDose,
    MedicineEvent,
    MedicineSchedule,
    Patient,
    SystemConfig,
    User,
)
from app.services.notifications import notify_dose
from app.services.realtime import enqueue_ws

ALLOWED: dict[str, set[str]] = {
    "scheduled": {"due", "dispensed", "taken", "missed", "cancelled"},
    "due": {"dispensed", "taken", "missed", "cancelled"},
    "dispensed": {"taken", "missed"},
    "missed": {"taken"},
    "taken": set(),
    "cancelled": set(),
}
OPEN_STATUSES = ("scheduled", "due", "dispensed")


def schedule_applies(s: MedicineSchedule, day: date) -> bool:
    return s.start_date <= day and (s.end_date is None or day <= s.end_date) and day.isoweekday() in s.days_of_week


def occurrence(s: MedicineSchedule, day: date, tz: str) -> datetime:
    return datetime.combine(day, s.time_of_day, tzinfo=ZoneInfo(tz)).astimezone(UTC)


def _dose_row(s: MedicineSchedule, med: Medicine, day: date, tz: str) -> dict[str, Any]:
    return {
        "patient_id": s.patient_id,
        "schedule_id": s.id,
        "medicine_id": med.id,
        "medicine_name": med.name,
        "dose_quantity": s.dose_quantity,
        "dose_unit": med.dose_unit,
        "period": s.period,
        "scheduled_for": occurrence(s, day, tz),
        "local_date": day,
        "status": "scheduled",
    }


def materialize(db: Session, now: datetime, schedule_id: int | None = None) -> None:
    """Create today's dose rows (in each patient's timezone) for active schedules. Idempotent."""
    # ponytail: re-checks every active schedule each tick; fine for thousands of schedules,
    # track a per-schedule "materialized_through" date if this ever shows up in profiles.
    q = (
        select(MedicineSchedule, Medicine, Patient.timezone)
        .join(Medicine, Medicine.id == MedicineSchedule.medicine_id)
        .join(Patient, Patient.id == MedicineSchedule.patient_id)
        .where(MedicineSchedule.is_active, Medicine.is_active, Patient.is_active)
    )
    if schedule_id is not None:
        q = q.where(MedicineSchedule.id == schedule_id)
    rows = []
    for s, med, tz in db.execute(q):
        day = now.astimezone(ZoneInfo(tz)).date()
        if not schedule_applies(s, day):
            continue
        row = _dose_row(s, med, day, tz)
        # A schedule created/edited at 3 PM must not produce an 8 AM dose that is instantly "missed".
        if row["scheduled_for"] < s.updated_at.replace(second=0, microsecond=0):
            continue
        rows.append(row)
    if rows:
        db.execute(pg_insert(MedicineDose).values(rows).on_conflict_do_nothing(constraint="uq_dose_schedule_time"))


def drop_upcoming(db: Session, schedule_id: int) -> None:
    db.execute(delete(MedicineDose).where(MedicineDose.schedule_id == schedule_id, MedicineDose.status == "scheduled"))


def reset_upcoming(db: Session, schedule_id: int, now: datetime) -> None:
    """After a schedule edit: drop its not-yet-due doses and rebuild today's occurrence."""
    drop_upcoming(db, schedule_id)
    db.flush()
    materialize(db, now, schedule_id)


def get_or_create_dose(db: Session, s: MedicineSchedule, day: date) -> MedicineDose | None:
    patient = db.get(Patient, s.patient_id)
    if not (s.is_active and schedule_applies(s, day)):
        return None
    row = _dose_row(s, s.medicine, day, patient.timezone)
    db.execute(pg_insert(MedicineDose).values(row).on_conflict_do_nothing(constraint="uq_dose_schedule_time"))
    return db.scalar(
        select(MedicineDose)
        .where(MedicineDose.schedule_id == s.id, MedicineDose.scheduled_for == row["scheduled_for"])
        .with_for_update(of=MedicineDose)
    )


def recipients(patient: Patient | None, device: Device | None = None) -> set[int]:
    ids = set()
    if patient is not None:
        ids.add(patient.caretaker_id)
    if device is not None:
        ids.add(device.owner_id)
    return ids


def record_event(
    db: Session,
    *,
    key: str,
    event_id: str,
    source: str,
    event_type: str,
    event_time: datetime,
    result: str = "applied",
    detail: str | None = None,
    patient: Patient | None = None,
    dose: MedicineDose | None = None,
    device: Device | None = None,
    actor: User | None = None,
    meta: dict[str, Any] | None = None,
) -> MedicineEvent | None:
    """Append to the event log. Returns None if this idempotency key was already recorded."""
    eid = db.scalar(
        pg_insert(MedicineEvent)
        .values(
            idempotency_key=key,
            event_id=event_id,
            source=source,
            event_type=event_type,
            result=result,
            detail=detail,
            patient_id=patient.id if patient else None,
            dose_id=dose.id if dose else None,
            device_id=device.id if device else None,
            actor_user_id=actor.id if actor else None,
            event_time=event_time,
            meta=meta or {},
        )
        .on_conflict_do_nothing(index_elements=["idempotency_key"])
        .returning(MedicineEvent.id)
    )
    if eid is None:
        return None
    enqueue_ws(db, recipients(patient, device), {"type": "event", "event_type": event_type, "id": eid})
    return db.get(MedicineEvent, eid)


def transition(
    db: Session, dose: MedicineDose, status: str, at: datetime, cfg: SystemConfig, device: Device | None = None
) -> bool:
    """Apply a state change if the state machine allows it. Caller records the event."""
    if status not in ALLOWED[dose.status]:
        return False
    dose.status = status
    if status in ("due", "dispensed", "taken") and dose.due_at is None:
        dose.due_at = at
    if status == "dispensed":
        dose.dispensed_at = at
    elif status == "taken":
        dose.taken_at = at
        dose.is_late = at > dose.scheduled_for + timedelta(minutes=cfg.late_dose_after_minutes)
    elif status == "missed":
        dose.missed_at = at
    elif status == "cancelled":
        dose.cancelled_at = at
    if device is not None:
        dose.device_id = device.id
    db.flush()
    enqueue_ws(db, recipients(dose.patient), {"type": "dose", "id": dose.id, "status": status})
    return True


def server_transition(db: Session, dose: MedicineDose, status: str, at: datetime, cfg: SystemConfig) -> None:
    if transition(db, dose, status, at, cfg):
        kind = f"medicine_{status}"
        record_event(
            db,
            key=f"server:dose:{dose.id}:{status}",
            event_id=f"dose-{dose.id}-{status}",
            source="server",
            event_type=kind,
            event_time=at,
            patient=dose.patient,
            dose=dose,
        )
        notify_dose(db, dose, kind)


def advance(db: Session, now: datetime, cfg: SystemConfig) -> None:
    """Scheduler step: SCHEDULED -> DUE at dose time, open doses -> MISSED after the timeout."""
    timeout = timedelta(minutes=cfg.missed_dose_timeout_minutes)
    becoming_due = db.scalars(
        select(MedicineDose)
        .where(MedicineDose.status == "scheduled", MedicineDose.scheduled_for <= now)
        .with_for_update(of=MedicineDose, skip_locked=True)
    ).all()
    for dose in becoming_due:
        if dose.scheduled_for > now - timeout:
            server_transition(db, dose, "due", dose.scheduled_for, cfg)
        else:  # server was down past the whole window
            server_transition(db, dose, "missed", now, cfg)

    overdue = db.scalars(
        select(MedicineDose)
        .where(MedicineDose.status.in_(("due", "dispensed")), MedicineDose.due_at <= now - timeout)
        .with_for_update(of=MedicineDose, skip_locked=True)
    ).all()
    for dose in overdue:
        server_transition(db, dose, "missed", now, cfg)


def _nearest(doses: list[MedicineDose], at: datetime) -> MedicineDose | None:
    return min(doses, key=lambda d: abs((d.scheduled_for - at).total_seconds()), default=None)


def resolve_dose(
    db: Session,
    patient: Patient,
    status: str,
    at: datetime,
    *,
    dose_id: int | None,
    schedule_id: int | None,
    medicine_id: int | None,
    slot: Any,
) -> MedicineDose | None:
    """Find which dose a device event refers to. Explicit ids win, then nearest open dose."""
    base = select(MedicineDose).where(MedicineDose.patient_id == patient.id).with_for_update(of=MedicineDose)
    if dose_id is not None:
        return db.scalar(base.where(MedicineDose.id == dose_id))
    if schedule_id is not None:
        s = db.get(MedicineSchedule, schedule_id)
        if s is None or s.patient_id != patient.id:
            return None
        window = base.where(
            MedicineDose.schedule_id == s.id,
            MedicineDose.scheduled_for.between(at - timedelta(hours=18), at + timedelta(hours=6)),
        )
        found = _nearest(list(db.scalars(window)), at)
        return found or get_or_create_dose(db, s, at.astimezone(ZoneInfo(patient.timezone)).date())
    if medicine_id is not None:
        base = base.where(MedicineDose.medicine_id == medicine_id)
    if slot in PERIODS:
        base = base.where(MedicineDose.period == slot)
    if status == "taken":
        # Pickup sensor fires after a dispense: confirm the most recently dispensed dose.
        recent = db.scalar(
            base.where(MedicineDose.status == "dispensed", MedicineDose.dispensed_at >= at - timedelta(hours=12))
            .order_by(MedicineDose.dispensed_at.desc())
            .limit(1)
        )
        if recent is not None:
            return recent
    window = base.where(MedicineDose.scheduled_for.between(at - timedelta(hours=12), at + timedelta(hours=3)))
    return _nearest([d for d in db.scalars(window) if status in ALLOWED[d.status]], at)


def dose_out(d: MedicineDose, device_uid: str | None = None) -> dict[str, Any]:
    return {
        "id": d.id,
        "patient_id": d.patient_id,
        "patient_name": d.patient.full_name,
        "patient_timezone": d.patient.timezone,
        "schedule_id": d.schedule_id,
        "medicine_id": d.medicine_id,
        "medicine_name": d.medicine_name,
        "dose_quantity": d.dose_quantity,
        "dose_unit": d.dose_unit,
        "period": d.period,
        "scheduled_for": d.scheduled_for,
        "local_date": d.local_date,
        "status": d.status,
        "due_at": d.due_at,
        "dispensed_at": d.dispensed_at,
        "taken_at": d.taken_at,
        "missed_at": d.missed_at,
        "cancelled_at": d.cancelled_at,
        "is_late": d.is_late,
        "device_uid": device_uid,
    }


def event_out(e: MedicineEvent, patient_name: str | None = None) -> dict[str, Any]:
    return {
        "id": e.id,
        "event_id": e.event_id,
        "source": e.source,
        "event_type": e.event_type,
        "result": e.result,
        "detail": e.detail,
        "device_uid": e.device.device_uid if e.device else None,
        "patient_id": e.patient_id,
        "patient_name": patient_name or (e.dose.patient.full_name if e.dose else None),
        "dose_id": e.dose_id,
        "medicine_name": e.dose.medicine_name if e.dose else None,
        "period": e.dose.period if e.dose else None,
        "event_time": e.event_time,
        "received_at": e.received_at,
    }
