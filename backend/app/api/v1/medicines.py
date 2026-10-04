from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.deps import DB, CurrentUser
from app.models import Medicine, MedicineDose, MedicineSchedule, Patient, User
from app.schemas import MedicineIn, MedicineOut, build
from app.services import doses
from app.services.system import audit, get_patient, patients_query

router = APIRouter(tags=["medicines"])


def medicines_out(db: Session, rows: list[tuple[Medicine, str]]) -> list[MedicineOut]:
    ids = [m.id for m, _ in rows]
    counts = dict(
        db.execute(
            select(MedicineSchedule.medicine_id, func.count())
            .where(MedicineSchedule.medicine_id.in_(ids), MedicineSchedule.is_active)
            .group_by(MedicineSchedule.medicine_id)
        ).all()
    )
    return [build(MedicineOut, m, patient_name=name, schedule_count=counts.get(m.id, 0)) for m, name in rows]


def _get_medicine(db: Session, user: User, medicine_id: int) -> Medicine:
    medicine = db.get(Medicine, medicine_id)
    if medicine is None:
        raise HTTPException(404, "Medicine not found")
    get_patient(db, user, medicine.patient_id)  # access check
    return medicine


def _one(db: Session, m: Medicine) -> MedicineOut:
    return medicines_out(db, [(m, db.get(Patient, m.patient_id).full_name)])[0]


@router.get("/medicines", response_model=list[MedicineOut])
def list_all(user: CurrentUser, db: DB, patient_id: int | None = None) -> list[MedicineOut]:
    visible = patients_query(user).with_only_columns(Patient.id)
    q = (
        select(Medicine, Patient.full_name)
        .join(Patient, Patient.id == Medicine.patient_id)
        .where(Medicine.patient_id.in_(visible))
        .order_by(Patient.full_name, Medicine.is_active.desc(), Medicine.name)
    )
    if patient_id is not None:
        q = q.where(Medicine.patient_id == patient_id)
    return medicines_out(db, [tuple(r) for r in db.execute(q)])


@router.get("/patients/{patient_id}/medicines", response_model=list[MedicineOut])
def list_for_patient(patient_id: int, user: CurrentUser, db: DB) -> list[MedicineOut]:
    get_patient(db, user, patient_id)
    return list_all(user, db, patient_id)


@router.post("/patients/{patient_id}/medicines", response_model=MedicineOut, status_code=201)
def create(patient_id: int, body: MedicineIn, user: CurrentUser, db: DB, request: Request) -> MedicineOut:
    patient = get_patient(db, user, patient_id)
    medicine = Medicine(patient_id=patient.id, **body.model_dump())
    db.add(medicine)
    db.flush()
    audit(db, "medicine.create", "medicine", medicine.id, user=user, request=request, patient_id=patient.id)
    db.commit()
    return _one(db, medicine)


@router.put("/medicines/{medicine_id}", response_model=MedicineOut)
def update(medicine_id: int, body: MedicineIn, user: CurrentUser, db: DB, request: Request) -> MedicineOut:
    medicine = _get_medicine(db, user, medicine_id)
    for field, value in body.model_dump().items():
        setattr(medicine, field, value)
    db.flush()
    # Upcoming doses keep a snapshot of name/unit; rebuild them so they match the edit.
    now = datetime.now(UTC)
    for sid in db.scalars(select(MedicineSchedule.id).where(MedicineSchedule.medicine_id == medicine.id)):
        doses.reset_upcoming(db, sid, now)
    audit(db, "medicine.update", "medicine", medicine.id, user=user, request=request)
    db.commit()
    return _one(db, medicine)


@router.delete("/medicines/{medicine_id}", status_code=204)
def delete(medicine_id: int, user: CurrentUser, db: DB, request: Request) -> None:
    medicine = _get_medicine(db, user, medicine_id)
    # Past doses keep their snapshot (medicine_id -> NULL); upcoming ones go with the schedules.
    db.execute(MedicineSchedule.__table__.delete().where(MedicineSchedule.medicine_id == medicine.id))
    db.execute(
        MedicineDose.__table__.delete().where(
            MedicineDose.medicine_id == medicine.id, MedicineDose.status == "scheduled"
        )
    )
    db.delete(medicine)
    audit(db, "medicine.delete", "medicine", medicine_id, user=user, request=request)
    db.commit()
