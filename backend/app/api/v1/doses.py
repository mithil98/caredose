"""Medicine history (dose occurrences), CSV export and caretaker dose actions."""

import csv
import io
import uuid
from datetime import UTC, date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import Select, func, select

from app.deps import DB, CurrentUser
from app.models import Device, MedicineDose, Patient, User
from app.schemas import DoseOut, DoseUpdateIn, Page
from app.services import doses
from app.services.system import audit, get_config, get_patient, patients_query

router = APIRouter(prefix="/doses", tags=["doses"])
HISTORY_STATUSES = ("scheduled", "due", "dispensed", "taken", "missed", "cancelled", "late")


def _filtered(
    user: User,
    patient_id: int | None,
    medicine_id: int | None,
    device_uid: str | None,
    status: str | None,
    date_from: date | None,
    date_to: date | None,
) -> Select[tuple[MedicineDose, str | None]]:
    q = (
        select(MedicineDose, Device.device_uid)
        .outerjoin(Device, Device.id == MedicineDose.device_id)
        .where(MedicineDose.patient_id.in_(patients_query(user).with_only_columns(Patient.id)))
    )
    if patient_id is not None:
        q = q.where(MedicineDose.patient_id == patient_id)
    if medicine_id is not None:
        q = q.where(MedicineDose.medicine_id == medicine_id)
    if device_uid:
        q = q.where(Device.device_uid == device_uid.upper())
    if status == "late":
        q = q.where(MedicineDose.status == "taken", MedicineDose.is_late)
    elif status:
        q = q.where(MedicineDose.status == status)
    if date_from:
        q = q.where(MedicineDose.local_date >= date_from)
    if date_to:
        q = q.where(MedicineDose.local_date <= date_to)
    return q


StatusFilter = Query(None, pattern=f"^({'|'.join(HISTORY_STATUSES)})$")


@router.get("", response_model=Page[DoseOut])
def history(
    user: CurrentUser,
    db: DB,
    patient_id: int | None = None,
    medicine_id: int | None = None,
    device_uid: str | None = None,
    status: str | None = StatusFilter,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
) -> dict[str, Any]:
    q = _filtered(user, patient_id, medicine_id, device_uid, status, date_from, date_to)
    total = db.scalar(select(func.count()).select_from(q.subquery()))
    rows = db.execute(
        q.order_by(MedicineDose.scheduled_for.desc(), MedicineDose.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).unique()
    return {
        "items": [doses.dose_out(d, uid) for d, uid in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/export.csv")
def export_csv(
    user: CurrentUser,
    db: DB,
    patient_id: int | None = None,
    medicine_id: int | None = None,
    device_uid: str | None = None,
    status: str | None = StatusFilter,
    date_from: date | None = None,
    date_to: date | None = None,
) -> StreamingResponse:
    q = _filtered(user, patient_id, medicine_id, device_uid, status, date_from, date_to)
    rows = db.execute(q.order_by(MedicineDose.scheduled_for.desc()).limit(10_000)).unique()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        ["date", "patient", "medicine", "dose", "period", "scheduled", "dispensed", "taken", "status", "late", "device"]
    )

    def local(at: datetime | None, tz: str) -> str:
        return at.astimezone(ZoneInfo(tz)).strftime("%H:%M") if at else ""

    for d, uid in rows:
        tz = d.patient.timezone
        w.writerow(
            [
                d.local_date.isoformat(),
                _safe(d.patient.full_name),
                _safe(d.medicine_name),
                f"{d.dose_quantity.normalize():f} {d.dose_unit}",
                d.period,
                local(d.scheduled_for, tz),
                local(d.dispensed_at, tz),
                local(d.taken_at, tz),
                d.status,
                "yes" if d.is_late else "",
                uid or "",
            ]
        )
    buf.seek(0)
    name = f"medicine-history-{datetime.now(UTC):%Y%m%d}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


def _safe(value: str) -> str:
    """Neutralise spreadsheet formula injection in user-entered text."""
    return "'" + value if value[:1] in ("=", "+", "-", "@") else value


@router.get("/{dose_id}", response_model=DoseOut)
def read_dose(dose_id: int, user: CurrentUser, db: DB) -> dict[str, Any]:
    dose = db.get(MedicineDose, dose_id)
    if dose is None:
        raise HTTPException(404, "Dose not found")
    get_patient(db, user, dose.patient_id)
    device = db.get(Device, dose.device_id) if dose.device_id else None
    return doses.dose_out(dose, device.device_uid if device else None)


@router.patch("/{dose_id}", response_model=DoseOut)
def update_dose(dose_id: int, body: DoseUpdateIn, user: CurrentUser, db: DB, request: Request) -> dict[str, Any]:
    """Caretaker confirms a dose manually (no device) or cancels it (e.g. hospital stay)."""
    dose = db.scalar(select(MedicineDose).where(MedicineDose.id == dose_id).with_for_update(of=MedicineDose))
    if dose is None:
        raise HTTPException(404, "Dose not found")
    get_patient(db, user, dose.patient_id)
    now = datetime.now(UTC)
    if not doses.transition(db, dose, body.status, now, get_config(db)):
        raise HTTPException(409, f"A dose that is {dose.status} cannot be marked {body.status}")
    doses.record_event(
        db,
        key=f"caretaker:{uuid.uuid4()}",
        event_id=f"manual-{dose.id}",
        source="caretaker",
        event_type=f"medicine_{body.status}",
        event_time=now,
        patient=dose.patient,
        dose=dose,
        actor=user,
    )
    audit(db, f"dose.{body.status}", "dose", dose.id, user=user, request=request)
    db.commit()
    return doses.dose_out(dose)
