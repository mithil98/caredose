"""Devices: caretaker management endpoints and the device-facing hardware contract."""

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import DB, CurrentUser, authenticated_device, device_limit
from app.models import Device, MedicineSchedule, User
from app.schemas import (
    DeviceConfigOut,
    DeviceCreateIn,
    DeviceKeyOut,
    DeviceOut,
    DeviceUpdateIn,
    HeartbeatIn,
    HeartbeatOut,
)
from app.services import devices
from app.services.auth import hash_device_key, new_device_key
from app.services.system import audit, devices_query, get_config, get_device, get_patient

router = APIRouter(prefix="/devices", tags=["devices"])
DeviceAuth = Annotated[Device, Depends(authenticated_device)]


def out(db: Session, d: Device) -> dict[str, Any]:
    owner = db.get(User, d.owner_id)
    return devices.device_out(d, get_config(db), datetime.now(UTC), owner.full_name)


def _assign(db: Session, user: User, d: Device, patient_id: int | None) -> None:
    if patient_id is None:
        d.patient_id = None
        return
    patient = get_patient(db, user, patient_id)
    d.patient_id = patient.id
    d.owner_id = patient.caretaker_id


@router.get("", response_model=list[DeviceOut])
def list_devices(user: CurrentUser, db: DB) -> list[dict[str, Any]]:
    return [out(db, d) for d in db.scalars(devices_query(user).order_by(Device.device_uid))]


@router.post("", response_model=DeviceKeyOut, status_code=201)
def register_device(body: DeviceCreateIn, user: CurrentUser, db: DB, request: Request) -> dict[str, Any]:
    if db.scalar(select(Device.id).where(Device.device_uid == body.device_uid)):
        raise HTTPException(409, f"Device {body.device_uid} is already registered")
    key = new_device_key()
    d = Device(device_uid=body.device_uid, name=body.name, owner_id=user.id, key_hash=hash_device_key(key))
    _assign(db, user, d, body.patient_id)
    db.add(d)
    db.flush()
    audit(db, "device.register", "device", d.device_uid, user=user, request=request)
    db.commit()
    return {"device": out(db, d), "device_key": key}


@router.get("/{device_uid}", response_model=DeviceOut)
def read_device(device_uid: str, user: CurrentUser, db: DB) -> dict[str, Any]:
    return out(db, get_device(db, user, device_uid))


@router.put("/{device_uid}", response_model=DeviceOut)
def update_device(device_uid: str, body: DeviceUpdateIn, user: CurrentUser, db: DB, request: Request) -> dict[str, Any]:
    d = get_device(db, user, device_uid)
    d.name, d.is_active = body.name, body.is_active
    _assign(db, user, d, body.patient_id)
    audit(db, "device.update", "device", d.device_uid, user=user, request=request, patient_id=d.patient_id)
    db.commit()
    db.refresh(d)
    return out(db, d)


@router.delete("/{device_uid}", status_code=204)
def delete_device(device_uid: str, user: CurrentUser, db: DB, request: Request) -> None:
    d = get_device(db, user, device_uid)
    db.delete(d)
    audit(db, "device.delete", "device", device_uid, user=user, request=request)
    db.commit()


@router.post("/{device_uid}/rotate-key", response_model=DeviceKeyOut)
def rotate_key(device_uid: str, user: CurrentUser, db: DB, request: Request) -> dict[str, Any]:
    """Issue a new device key (the old one stops working immediately)."""
    d = get_device(db, user, device_uid)
    key = new_device_key()
    d.key_hash = hash_device_key(key)
    audit(db, "device.rotate_key", "device", d.device_uid, user=user, request=request)
    db.commit()
    return {"device": out(db, d), "device_key": key}


# ----- device-facing (authenticated with X-Device-Key) -----


@router.post("/{device_id}/heartbeat", response_model=HeartbeatOut, dependencies=[Depends(device_limit)])
def heartbeat(device_id: str, body: HeartbeatIn, device: DeviceAuth, db: DB) -> dict[str, Any]:
    if body.device_id and body.device_id.upper() != device.device_uid:
        raise HTTPException(422, "device_id in body does not match the URL")
    now = datetime.now(UTC)
    devices.heartbeat(db, device, body, now)
    db.commit()
    return {
        "device_id": device.device_uid,
        "status": devices.status_of(device, get_config(db), now),
        "server_time": now,
        "heartbeat_interval_seconds": devices.HEARTBEAT_INTERVAL_SECONDS,
    }


@router.get("/{device_id}/config", response_model=DeviceConfigOut, dependencies=[Depends(device_limit)])
def device_config(device_id: str, device: DeviceAuth, db: DB) -> dict[str, Any]:
    """Schedules the dispenser should follow (times are local to `timezone`)."""
    cfg = get_config(db)
    patient = device.patient
    schedules = []
    if patient is not None:
        rows = db.scalars(
            select(MedicineSchedule)
            .where(MedicineSchedule.patient_id == patient.id, MedicineSchedule.is_active)
            .order_by(MedicineSchedule.time_of_day)
        )
        schedules = [
            {
                "schedule_id": s.id,
                "medicine_id": s.medicine_id,
                "medicine_name": s.medicine.name,
                "dose_quantity": s.dose_quantity,
                "dose_unit": s.medicine.dose_unit,
                "time_of_day": s.time_of_day.strftime("%H:%M"),
                "period": s.period,
                "days_of_week": s.days_of_week,
                "start_date": s.start_date,
                "end_date": s.end_date,
            }
            for s in rows
            if s.medicine.is_active
        ]
    return {
        "device_id": device.device_uid,
        "patient_assigned": patient is not None,
        "timezone": patient.timezone if patient else "UTC",
        "server_time": datetime.now(UTC),
        "heartbeat_interval_seconds": devices.HEARTBEAT_INTERVAL_SECONDS,
        "missed_dose_timeout_minutes": cfg.missed_dose_timeout_minutes,
        "schedules": schedules,
    }
