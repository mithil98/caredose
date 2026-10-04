"""Scheduler / dose state machine with a controlled clock (schedule: 20:00 Asia/Kolkata = 14:30 UTC)."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from app.database import engine
from app.models import MedicineDose, MedicineEvent, Notification, NotificationPreference
from app.services import doses
from app.services.system import get_config
from app.workers.scheduler import LOCK_ID, tick

DUE = datetime(2026, 10, 5, 14, 30, tzinfo=UTC)  # Monday 20:00 IST


@pytest.fixture
def engine_setup(setup, db):
    db.execute(text("UPDATE medicine_schedules SET updated_at = '2026-01-01', start_date = '2026-01-01'"))
    db.execute(text("DELETE FROM medicine_doses"))
    db.commit()
    return setup


def dose(db) -> MedicineDose:
    db.expire_all()
    return db.query(MedicineDose).one()


def kinds(db) -> list[str]:
    return [n.type for n in db.query(Notification).order_by(Notification.id)]


def test_dose_goes_due_then_missed_without_duplicates(engine_setup, db, fake_push):
    tick(DUE - timedelta(minutes=30))
    tick(DUE - timedelta(minutes=20))
    d = dose(db)
    assert d.status == "scheduled"
    assert d.local_date.isoformat() == "2026-10-05"
    assert d.scheduled_for == DUE

    tick(DUE + timedelta(seconds=30))
    tick(DUE + timedelta(seconds=60))
    assert dose(db).status == "due"
    assert kinds(db) == ["medicine_due"]

    tick(DUE + timedelta(minutes=61))
    tick(DUE + timedelta(minutes=62))
    d = dose(db)
    assert d.status == "missed" and d.missed_at is not None
    assert kinds(db) == ["medicine_due", "medicine_missed"]
    missed = db.query(Notification).filter_by(type="medicine_missed").one()
    assert missed.title == "⚠️ Medicine Missed"
    assert "Rahul's night dose has not been confirmed" in missed.body
    server_events = [
        e.event_type for e in db.query(MedicineEvent).filter_by(source="server").order_by(MedicineEvent.id)
    ]
    assert server_events == ["medicine_due", "medicine_missed"]


def test_dispensed_but_not_taken_becomes_missed(engine_setup, db):
    tick(DUE + timedelta(seconds=10))
    cfg = get_config(db)
    d = dose(db)
    assert doses.transition(db, d, "dispensed", DUE + timedelta(minutes=2), cfg)
    db.commit()
    tick(DUE + timedelta(minutes=59))
    assert dose(db).status == "dispensed"
    tick(DUE + timedelta(minutes=61))
    assert dose(db).status == "missed"


def test_taken_in_time_is_not_missed_and_late_flag(engine_setup, db):
    tick(DUE + timedelta(seconds=10))
    cfg = get_config(db)
    d = dose(db)
    doses.transition(db, d, "taken", DUE + timedelta(minutes=4), cfg)
    db.commit()
    tick(DUE + timedelta(hours=3))
    d = dose(db)
    assert d.status == "taken" and d.is_late is False

    # confirmation after the dose was declared missed is kept, flagged late
    db.execute(text("UPDATE medicine_doses SET status='missed', taken_at=NULL"))
    db.commit()
    d = dose(db)
    assert doses.transition(db, d, "taken", DUE + timedelta(minutes=90), cfg)
    assert d.is_late is True


def test_server_downtime_marks_stale_doses_missed_directly(engine_setup, db):
    tick(DUE + timedelta(hours=2))
    assert dose(db).status == "missed"
    assert kinds(db) == ["medicine_missed"]


def test_schedule_created_after_dose_time_does_not_backfill(setup, db):
    db.execute(text("DELETE FROM medicine_doses"))
    db.execute(
        text("UPDATE medicine_schedules SET start_date = '2026-01-01', updated_at = :t"),
        {"t": DUE + timedelta(hours=1)},
    )
    db.commit()
    tick(DUE + timedelta(hours=1, minutes=5))
    assert db.query(MedicineDose).count() == 0


def test_schedule_respects_days_of_week_and_end_date(engine_setup, db):
    db.execute(text("UPDATE medicine_schedules SET days_of_week = '{2,3}'"))  # Tue, Wed only
    db.commit()
    tick(DUE - timedelta(hours=1))  # Monday
    assert db.query(MedicineDose).count() == 0
    db.execute(text("UPDATE medicine_schedules SET days_of_week = '{1}', end_date = '2026-10-04'"))
    db.commit()
    tick(DUE - timedelta(hours=1))
    assert db.query(MedicineDose).count() == 0


def test_tick_is_skipped_while_another_holds_the_lock(engine_setup, db):
    with engine.connect() as other:
        other.execute(text("SELECT pg_advisory_lock(:id)"), {"id": LOCK_ID})
        try:
            assert tick(DUE + timedelta(seconds=10)) is False
        finally:
            other.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": LOCK_ID})
            other.commit()
    assert tick(DUE + timedelta(seconds=10)) is True


def test_preferences_suppress_push_but_keep_in_app_notification(engine_setup, client, db, fake_push):
    auth = engine_setup["auth"]
    client.post(
        "/api/v1/notifications/push-subscription",
        headers=auth,
        json={"endpoint": "https://fcm.googleapis.com/fcm/send/x", "keys": {"p256dh": "B" * 87, "auth": "A" * 22}},
    )
    prefs = client.get("/api/v1/notifications/preferences", headers=auth).json()
    client.put("/api/v1/notifications/preferences", headers=auth, json={**prefs, "medicine_due": False})
    tick(DUE + timedelta(seconds=10))
    n = db.query(Notification).filter_by(type="medicine_due").one()
    assert fake_push.sent == []
    assert n.push_error == "disabled in notification preferences"
    assert db.get(NotificationPreference, n.user_id).medicine_due is False

    tick(DUE + timedelta(minutes=61))  # missed is still enabled -> pushed
    assert [p["type"] for _, p in fake_push.sent] == ["medicine_missed"]
