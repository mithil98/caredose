from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import DB, CurrentUser
from app.models import Medicine, MedicineSchedule, Patient, User
from app.schemas import ScheduleIn, ScheduleOut, build
from app.services import doses
from app.services.analytics import local_today
from app.services.system import audit, get_patient, patients_query

router = APIRouter(tags=["schedules"])


def schedule_out(s: MedicineSchedule, patient_name: str) -> ScheduleOut:
    return build(
        ScheduleOut, s, patient_name=patient_name, medicine_name=s.medicine.name, dose_unit=s.medicine.dose_unit
    )


def _get_schedule(db: Session, user: User, schedule_id: int) -> tuple[MedicineSchedule, Patient]:
    schedule = db.get(MedicineSchedule, schedule_id)
    if schedule is None:
        raise HTTPException(404, "Schedule not found")
    return schedule, get_patient(db, user, schedule.patient_id)


def _apply(db: Session, schedule: MedicineSchedule, patient: Patient, body: ScheduleIn) -> None:
    medicine = db.get(Medicine, body.medicine_id)
    if medicine is None or medicine.patient_id != patient.id:
        raise HTTPException(422, "Medicine does not belong to this patient")
    schedule.medicine_id = medicine.id
    schedule.dose_quantity = body.dose_quantity or medicine.dose_quantity
    schedule.time_of_day = body.time_of_day
    schedule.period = body.period
    schedule.days_of_week = body.days_of_week
    schedule.start_date = body.start_date or schedule.start_date or local_today(patient.timezone, datetime.now(UTC))
    schedule.end_date = body.end_date
    schedule.is_active = body.is_active
    if schedule.end_date and schedule.end_date < schedule.start_date:
        raise HTTPException(422, "End date must be on or after the start date")


@router.get("/schedules", response_model=list[ScheduleOut])
def list_all(user: CurrentUser, db: DB, patient_id: int | None = None) -> list[ScheduleOut]:
    visible = patients_query(user).with_only_columns(Patient.id)
    q = (
        select(MedicineSchedule, Patient.full_name)
        .join(Patient, Patient.id == MedicineSchedule.patient_id)
        .where(MedicineSchedule.patient_id.in_(visible))
        .order_by(MedicineSchedule.time_of_day, Patient.full_name)
    )
    if patient_id is not None:
        q = q.where(MedicineSchedule.patient_id == patient_id)
    return [schedule_out(s, name) for s, name in db.execute(q).unique()]


@router.get("/patients/{patient_id}/schedules", response_model=list[ScheduleOut])
def list_for_patient(patient_id: int, user: CurrentUser, db: DB) -> list[ScheduleOut]:
    get_patient(db, user, patient_id)
    return list_all(user, db, patient_id)


@router.post("/patients/{patient_id}/schedules", response_model=ScheduleOut, status_code=201)
def create(patient_id: int, body: ScheduleIn, user: CurrentUser, db: DB, request: Request) -> ScheduleOut:
    patient = get_patient(db, user, patient_id)
    schedule = MedicineSchedule(patient_id=patient.id)
    _apply(db, schedule, patient, body)
    db.add(schedule)
    db.flush()
    doses.reset_upcoming(db, schedule.id, datetime.now(UTC))
    audit(db, "schedule.create", "schedule", schedule.id, user=user, request=request, patient_id=patient.id)
    db.commit()
    return schedule_out(schedule, patient.full_name)


@router.put("/schedules/{schedule_id}", response_model=ScheduleOut)
def update(schedule_id: int, body: ScheduleIn, user: CurrentUser, db: DB, request: Request) -> ScheduleOut:
    schedule, patient = _get_schedule(db, user, schedule_id)
    _apply(db, schedule, patient, body)
    schedule.updated_at = datetime.now(UTC)
    db.flush()
    doses.reset_upcoming(db, schedule.id, datetime.now(UTC))
    audit(db, "schedule.update", "schedule", schedule.id, user=user, request=request)
    db.commit()
    db.refresh(schedule)
    return schedule_out(schedule, patient.full_name)


@router.delete("/schedules/{schedule_id}", status_code=204)
def delete(schedule_id: int, user: CurrentUser, db: DB, request: Request) -> None:
    schedule, _ = _get_schedule(db, user, schedule_id)
    doses.drop_upcoming(db, schedule.id)
    db.delete(schedule)
    audit(db, "schedule.delete", "schedule", schedule_id, user=user, request=request)
    db.commit()
