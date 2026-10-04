"""Caretaker dashboard aggregate and adherence analytics."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter
from sqlalchemy import select

from app.deps import DB, CurrentUser
from app.models import Device, MedicineDose, MedicineEvent, Notification, Patient
from app.schemas import AdherenceOut, DashboardOut
from app.services import analytics, devices
from app.services.doses import OPEN_STATUSES, dose_out, event_out
from app.services.system import get_config, get_patient, patients_query

from .notifications import notification_out

router = APIRouter(tags=["analytics"])


@router.get("/analytics/patients/{patient_id}/adherence", response_model=AdherenceOut)
def patient_adherence(patient_id: int, user: CurrentUser, db: DB) -> dict[str, Any]:
    patient = get_patient(db, user, patient_id)
    now = datetime.now(UTC)
    today = analytics.local_today(patient.timezone, now)
    return {"patient_id": patient.id, **analytics.adherence(db, [patient.id], today, now)}


@router.get("/analytics/adherence", response_model=AdherenceOut)
def overall_adherence(user: CurrentUser, db: DB) -> dict[str, Any]:
    now = datetime.now(UTC)
    ids = list(db.scalars(patients_query(user).with_only_columns(Patient.id)))
    today = analytics.local_today(user.timezone, now)
    return {"patient_id": None, **analytics.adherence(db, ids, today, now)}


def _alert(today: dict[str, Any], device: dict[str, Any] | None, has_due: bool) -> str:
    if today["missed"]:
        return "missed"
    if device and device["status"] == "error":
        return "device_error"
    if device and device["status"] == "offline":
        return "device_offline"
    return "due" if has_due else "ok"


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(user: CurrentUser, db: DB) -> dict[str, Any]:
    """Everything the caretaker needs for "today" in one request."""
    now = datetime.now(UTC)
    cfg = get_config(db)
    patients = list(db.scalars(patients_query(user).where(Patient.is_active).order_by(Patient.full_name)).unique())
    ids = [p.id for p in patients]
    today_stats = analytics.today_by_patient(db, patients, now)
    local_days = {p.id: analytics.local_today(p.timezone, now) for p in patients}

    dev_rows = list(db.scalars(select(Device).where(Device.patient_id.in_(ids), Device.is_active)))
    device_by_patient = {}
    for d in dev_rows:
        device_by_patient.setdefault(d.patient_id, devices.brief(d, cfg, now))
    all_devices = [
        devices.brief(d, cfg, now)
        for d in db.scalars(
            select(Device).where(Device.is_active, Device.owner_id == user.id)
            if user.role != "admin"
            else select(Device).where(Device.is_active)
        )
    ]

    window = {local_days[pid] for pid in ids}
    uid_by_id = {d.id: d.device_uid for d in dev_rows}
    today_doses = [
        d
        for d in db.scalars(
            select(MedicineDose)
            .where(MedicineDose.patient_id.in_(ids), MedicineDose.local_date.in_(window))
            .order_by(MedicineDose.scheduled_for)
        ).unique()
        if d.local_date == local_days[d.patient_id]
    ]

    overview = []
    for p in patients:
        mine = [d for d in today_doses if d.patient_id == p.id]
        upcoming = next((d for d in mine if d.status in OPEN_STATUSES), None)
        has_due = any(d.status in ("due", "dispensed") for d in mine)
        device = device_by_patient.get(p.id)
        overview.append(
            {
                "id": p.id,
                "full_name": p.full_name,
                "timezone": p.timezone,
                "device": device,
                "today": today_stats[p.id],
                "next_dose": dose_out(upcoming, uid_by_id.get(upcoming.device_id)) if upcoming else None,
                "alert": _alert(today_stats[p.id], device, has_due),
            }
        )

    totals = {
        k: sum(s[k] for s in today_stats.values()) for k in ("taken", "missed", "late", "pending", "scheduled", "total")
    }
    names = {p.id: p.full_name for p in patients}
    activity = db.scalars(
        select(MedicineEvent)
        .where(MedicineEvent.patient_id.in_(ids) | MedicineEvent.device_id.in_([d["id"] for d in all_devices]))
        .order_by(MedicineEvent.event_time.desc(), MedicineEvent.id.desc())
        .limit(15)
    ).unique()
    alerts = db.scalars(
        select(Notification)
        .where(
            Notification.user_id == user.id,
            Notification.type != "test",
            Notification.created_at >= now - timedelta(hours=24),
        )
        .order_by(Notification.read_at.is_not(None), Notification.created_at.desc())
        .limit(8)
    ).unique()
    week_start = analytics.local_today(user.timezone, now) - timedelta(days=6)
    return {
        "generated_at": now,
        "summary": {
            "patients": len(patients),
            "doses_today": totals["total"],
            "taken": totals["taken"],
            "pending": totals["pending"],
            "missed": totals["missed"],
            "late": totals["late"],
            "devices_total": len(all_devices),
            "devices_online": sum(d["status"] == "online" for d in all_devices),
            "devices_offline": sum(d["status"] in ("offline", "error") for d in all_devices),
            "adherence_today": round(totals["taken"] / totals["scheduled"] * 100, 1) if totals["scheduled"] else None,
        },
        "doses": [dose_out(d, uid_by_id.get(d.device_id)) for d in today_doses],
        "patients": overview,
        "activity": [event_out(e, names.get(e.patient_id)) for e in activity],
        "alerts": [notification_out(n) for n in alerts],
        "week": analytics.daily(db, ids, week_start, week_start + timedelta(days=6), now),
    }
