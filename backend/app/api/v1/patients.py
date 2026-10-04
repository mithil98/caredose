from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.deps import DB, CurrentUser
from app.models import Device, Medicine, Patient, User
from app.schemas import PatientIn, PatientOut
from app.services import analytics, devices
from app.services.system import audit, get_config, get_patient, patients_query

router = APIRouter(prefix="/patients", tags=["patients"])


def patients_out(db: Session, patients: list[Patient]) -> list[dict[str, Any]]:
    now = datetime.now(UTC)
    cfg = get_config(db)
    ids = [p.id for p in patients]
    med_counts = dict(
        db.execute(
            select(Medicine.patient_id, func.count())
            .where(Medicine.patient_id.in_(ids), Medicine.is_active)
            .group_by(Medicine.patient_id)
        ).all()
    )
    today = analytics.today_by_patient(db, patients, now)
    return [
        {
            "id": p.id,
            "full_name": p.full_name,
            "date_of_birth": p.date_of_birth,
            "contact_phone": p.contact_phone,
            "notes": p.notes,
            "timezone": p.timezone,
            "is_active": p.is_active,
            "created_at": p.created_at,
            "caretaker": {"id": p.caretaker.id, "full_name": p.caretaker.full_name},
            "devices": [devices.brief(d, cfg, now) for d in p.devices if d.is_active],
            "medicine_count": med_counts.get(p.id, 0),
            "today": today[p.id],
        }
        for p in patients
    ]


def _caretaker_for(db: Session, user: User, body: PatientIn, current: int | None) -> int:
    if user.role != "admin" or body.caretaker_id is None:
        return current or user.id
    target = db.get(User, body.caretaker_id)
    if target is None or not target.is_active:
        raise HTTPException(422, "Caretaker not found")
    return target.id


@router.get("", response_model=list[PatientOut])
def list_patients(user: CurrentUser, db: DB, include_inactive: bool = True) -> list[dict[str, Any]]:
    q = patients_query(user).order_by(Patient.is_active.desc(), Patient.full_name)
    if not include_inactive:
        q = q.where(Patient.is_active)
    return patients_out(db, list(db.scalars(q).unique()))


@router.post("", response_model=PatientOut, status_code=201)
def create_patient(body: PatientIn, user: CurrentUser, db: DB, request: Request) -> dict[str, Any]:
    patient = Patient(**body.model_dump(exclude={"caretaker_id"}), caretaker_id=_caretaker_for(db, user, body, None))
    db.add(patient)
    db.flush()
    audit(db, "patient.create", "patient", patient.id, user=user, request=request)
    db.commit()
    db.refresh(patient)
    return patients_out(db, [patient])[0]


@router.get("/{patient_id}", response_model=PatientOut)
def read_patient(patient_id: int, user: CurrentUser, db: DB) -> dict[str, Any]:
    return patients_out(db, [get_patient(db, user, patient_id)])[0]


@router.put("/{patient_id}", response_model=PatientOut)
def update_patient(patient_id: int, body: PatientIn, user: CurrentUser, db: DB, request: Request) -> dict[str, Any]:
    patient = get_patient(db, user, patient_id)
    for field, value in body.model_dump(exclude={"caretaker_id"}).items():
        setattr(patient, field, value)
    new_owner = _caretaker_for(db, user, body, patient.caretaker_id)
    if new_owner != patient.caretaker_id:
        patient.caretaker_id = new_owner
        # Devices follow their patient so the new caretaker can see them.
        for d in db.scalars(select(Device).where(Device.patient_id == patient.id)):
            d.owner_id = new_owner
    audit(db, "patient.update", "patient", patient.id, user=user, request=request)
    db.commit()
    db.refresh(patient)
    return patients_out(db, [patient])[0]


@router.delete("/{patient_id}", status_code=204)
def delete_patient(patient_id: int, user: CurrentUser, db: DB, request: Request) -> None:
    patient = get_patient(db, user, patient_id)
    db.delete(patient)
    audit(db, "patient.delete", "patient", patient_id, user=user, request=request)
    db.commit()
