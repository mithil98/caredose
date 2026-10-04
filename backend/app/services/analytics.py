"""Adherence statistics. Adherence = confirmed taken doses / scheduled doses so far x 100."""

from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models import MedicineDose, Patient

FIELDS = ("scheduled", "taken", "missed", "late", "pending", "total")


def _counts(now: datetime):
    d = MedicineDose
    # A dose counts towards the denominator once its time has passed or it was resolved early.
    counted = and_(d.status != "cancelled", or_(d.scheduled_for <= now, d.status.in_(("taken", "missed"))))
    return (
        func.count().filter(counted).label("scheduled"),
        func.count().filter(d.status == "taken").label("taken"),
        func.count().filter(d.status == "missed").label("missed"),
        func.count().filter(and_(d.status == "taken", d.is_late)).label("late"),
        func.count().filter(d.status.in_(("scheduled", "due", "dispensed"))).label("pending"),
        func.count().filter(d.status != "cancelled").label("total"),
    )


def stats(row: Any) -> dict[str, Any]:
    out = {f: int(getattr(row, f, 0) or 0) for f in FIELDS}
    out["adherence"] = round(out["taken"] / out["scheduled"] * 100, 1) if out["scheduled"] else None
    return out


def summarize(db: Session, patient_ids: list[int], start: date, end: date, now: datetime) -> dict[str, Any]:
    row = db.execute(
        select(*_counts(now)).where(
            MedicineDose.patient_id.in_(patient_ids), MedicineDose.local_date.between(start, end)
        )
    ).one()
    return stats(row)


def daily(db: Session, patient_ids: list[int], start: date, end: date, now: datetime) -> list[dict[str, Any]]:
    rows = db.execute(
        select(MedicineDose.local_date, *_counts(now))
        .where(MedicineDose.patient_id.in_(patient_ids), MedicineDose.local_date.between(start, end))
        .group_by(MedicineDose.local_date)
    ).all()
    by_day = {r.local_date: stats(r) for r in rows}
    days = (start + timedelta(days=i) for i in range((end - start).days + 1))
    empty = stats(None)
    return [{"date": day, **by_day.get(day, empty)} for day in days]


def local_today(tz: str, now: datetime) -> date:
    return now.astimezone(ZoneInfo(tz)).date()


def today_by_patient(db: Session, patients: list[Patient], now: datetime) -> dict[int, dict[str, Any]]:
    """Today's stats per patient, where "today" is each patient's own local date."""
    days = {p.id: local_today(p.timezone, now) for p in patients}
    out = {pid: stats(None) for pid in days}
    if not days:
        return out
    rows = db.execute(
        select(MedicineDose.patient_id, MedicineDose.local_date, *_counts(now))
        .where(MedicineDose.patient_id.in_(days), MedicineDose.local_date.in_(set(days.values())))
        .group_by(MedicineDose.patient_id, MedicineDose.local_date)
    ).all()
    for r in rows:
        if days[r.patient_id] == r.local_date:
            out[r.patient_id] = stats(r)
    return out


def adherence(db: Session, patient_ids: list[int], today: date, now: datetime) -> dict[str, Any]:
    return {
        "today": summarize(db, patient_ids, today, today, now),
        "week": summarize(db, patient_ids, today - timedelta(days=6), today, now),
        "month": summarize(db, patient_ids, today - timedelta(days=29), today, now),
        "daily": daily(db, patient_ids, today - timedelta(days=29), today, now),
    }
