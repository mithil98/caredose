"""Development seed data (never real patient data).

    python -m app.seed [--password PASS] [--history DAYS]

Creates an admin, a demo caretaker, "Demo Patient" with device MED-001, three medicines and
08:00 / 13:00 / 20:00 schedules. --history adds synthetic past doses so charts have data.
"""

import argparse
import random
import secrets
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.config import get_settings
from app.database import SessionLocal
from app.models import Device, Medicine, MedicineDose, MedicineSchedule, Patient, User
from app.services.auth import create_user, hash_device_key, new_device_key
from app.services.doses import occurrence

EVERY_DAY = [1, 2, 3, 4, 5, 6, 7]
PLAN = [
    ("Morning Medicine", "morning", time(8, 0), "After breakfast"),
    ("Afternoon Medicine", "afternoon", time(13, 0), "After lunch"),
    ("Night Medicine", "night", time(20, 0), "Before sleep"),
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--password", help="password for both demo accounts (default: random, printed)")
    parser.add_argument("--history", type=int, default=0, help="days of synthetic dose history to add")
    args = parser.parse_args()
    if get_settings().is_production:
        raise SystemExit("Refusing to seed demo data in production")
    password = args.password or secrets.token_urlsafe(10)
    tz = get_settings().default_timezone

    with SessionLocal() as db:
        if db.scalar(select(User).where(User.email == "caretaker@example.com")):
            raise SystemExit("Seed data already present (caretaker@example.com exists)")
        create_user(
            db, email="admin@example.com", password=password, full_name="System Admin", role="admin", timezone=tz
        )
        caretaker = create_user(
            db,
            email="caretaker@example.com",
            password=password,
            full_name="Demo Caretaker",
            role="caretaker",
            timezone=tz,
        )
        patient = Patient(caretaker_id=caretaker.id, full_name="Demo Patient", timezone=tz, notes="Seeded demo record")
        db.add(patient)
        db.flush()
        key = new_device_key()
        db.add(
            Device(
                device_uid="MED-001",
                name="Living room dispenser",
                owner_id=caretaker.id,
                patient_id=patient.id,
                key_hash=hash_device_key(key),
            )
        )
        today = datetime.now(UTC).date()
        start = today - timedelta(days=args.history)
        schedules = []
        for name, period, at, note in PLAN:
            med = Medicine(patient_id=patient.id, name=name, dose_quantity=1, dose_unit="tablet", instructions=note)
            db.add(med)
            db.flush()
            s = MedicineSchedule(
                patient_id=patient.id,
                medicine_id=med.id,
                dose_quantity=1,
                time_of_day=at,
                period=period,
                days_of_week=EVERY_DAY,
                start_date=start,
            )
            db.add(s)
            schedules.append((s, med))
        db.flush()
        if args.history:
            _history(db, patient, schedules, args.history)
        db.commit()

    print("Seeded demo data")
    print("  admin:      admin@example.com      /", password)
    print("  caretaker:  caretaker@example.com  /", password)
    print("  device:     MED-001  X-Device-Key:", key)


def _history(db, patient, schedules, days: int) -> None:  # noqa: ANN001
    """Synthetic outcomes for past days, labelled via notes; used only to populate charts."""
    rng = random.Random(42)
    local_today = datetime.now(ZoneInfo(patient.timezone)).date()
    for offset in range(days, 0, -1):
        day = local_today - timedelta(days=offset)
        for s, med in schedules:
            at = occurrence(s, day, patient.timezone)
            roll = rng.random()
            status = "taken" if roll < 0.85 else "missed"
            late = status == "taken" and roll > 0.75
            taken_at = at + timedelta(minutes=rng.randint(35, 70) if late else rng.randint(1, 15))
            db.add(
                MedicineDose(
                    patient_id=patient.id,
                    schedule_id=s.id,
                    medicine_id=med.id,
                    medicine_name=med.name,
                    dose_quantity=s.dose_quantity,
                    dose_unit=med.dose_unit,
                    period=s.period,
                    scheduled_for=at,
                    local_date=day,
                    status=status,
                    due_at=at,
                    dispensed_at=at + timedelta(minutes=1),
                    taken_at=taken_at if status == "taken" else None,
                    missed_at=at + timedelta(hours=1) if status == "missed" else None,
                    is_late=late,
                )
            )


if __name__ == "__main__":
    main()
