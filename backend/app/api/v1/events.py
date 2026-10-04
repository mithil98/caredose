"""Device event ingestion (hardware contract) and the event log."""

from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, or_, select

from app.deps import DB, CurrentUser, DeviceKey, device_limit, load_device
from app.models import Device, MedicineEvent, Patient
from app.schemas import DeviceEventIn, DeviceEventOut, EventOut, Page
from app.services import devices
from app.services.doses import event_out
from app.services.system import devices_query, get_config, patients_query

router = APIRouter(prefix="/device-events", tags=["device events"])


@router.post(
    "",
    response_model=DeviceEventOut,
    status_code=201,
    dependencies=[Depends(device_limit)],
    responses={200: {"description": "Duplicate event_id: the original result is returned"}},
)
def ingest(body: DeviceEventIn, response: Response, db: DB, x_device_key: DeviceKey = None) -> dict[str, Any]:
    """Receive one event from a dispenser (or the simulator). Safe to retry with the same event_id."""
    device = load_device(db, body.device_id, x_device_key)
    event, duplicate = devices.ingest_event(db, device, body, datetime.now(UTC), get_config(db))
    db.commit()
    if duplicate:
        response.status_code = 200
    dose = event.dose
    return {
        "id": event.id,
        "event_id": event.event_id,
        "event_type": event.event_type,
        "result": event.result,
        "duplicate": duplicate,
        "detail": event.detail,
        "dose_id": event.dose_id,
        "dose_status": dose.status if dose else None,
        "received_at": event.received_at,
    }


@router.get("", response_model=Page[EventOut])
def list_events(
    user: CurrentUser,
    db: DB,
    patient_id: int | None = None,
    device_uid: str | None = None,
    event_type: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
) -> dict[str, Any]:
    visible_patients = patients_query(user).with_only_columns(Patient.id)
    visible_devices = devices_query(user).with_only_columns(Device.id)
    q = select(MedicineEvent).where(
        or_(MedicineEvent.patient_id.in_(visible_patients), MedicineEvent.device_id.in_(visible_devices))
    )
    if patient_id is not None:
        q = q.where(MedicineEvent.patient_id == patient_id)
    if device_uid:
        q = q.where(MedicineEvent.device_id.in_(select(Device.id).where(Device.device_uid == device_uid.upper())))
    if event_type:
        q = q.where(MedicineEvent.event_type == event_type)
    if date_from:
        q = q.where(MedicineEvent.event_time >= datetime.combine(date_from, time.min, UTC))
    if date_to:
        q = q.where(MedicineEvent.event_time < datetime.combine(date_to + timedelta(days=1), time.min, UTC))
    total = db.scalar(select(func.count()).select_from(q.subquery()))
    rows = db.scalars(
        q.order_by(MedicineEvent.event_time.desc(), MedicineEvent.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).unique()
    names = dict(db.execute(select(Patient.id, Patient.full_name).where(Patient.id.in_(visible_patients))).all())
    return {
        "items": [event_out(e, names.get(e.patient_id)) for e in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
