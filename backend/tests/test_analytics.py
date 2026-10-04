from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from app.models import MedicineDose
from app.services import analytics

NOW = datetime(2026, 10, 5, 12, 0, tzinfo=UTC)
TODAY = date(2026, 10, 5)


def add(db, pid, day, hour, status, late=False):
    db.add(
        MedicineDose(
            patient_id=pid,
            medicine_name="M",
            dose_quantity=Decimal(1),
            dose_unit="tablet",
            period="morning",
            scheduled_for=datetime(day.year, day.month, day.day, hour, tzinfo=UTC),
            local_date=day,
            status=status,
            is_late=late,
        )
    )


def test_adherence_formula(setup, db):
    pid = setup["patient_id"]
    db.query(MedicineDose).delete()
    add(db, pid, TODAY, 2, "taken")
    add(db, pid, TODAY, 6, "taken", late=True)
    add(db, pid, TODAY, 8, "missed")
    add(db, pid, TODAY, 9, "cancelled")  # excluded
    add(db, pid, TODAY, 18, "scheduled")  # future: not counted yet
    add(db, pid, TODAY - timedelta(days=3), 8, "taken")
    add(db, pid, TODAY - timedelta(days=20), 8, "missed")
    db.commit()

    today = analytics.summarize(db, [pid], TODAY, TODAY, NOW)
    assert today == {"scheduled": 3, "taken": 2, "missed": 1, "late": 1, "pending": 1, "total": 4, "adherence": 66.7}

    result = analytics.adherence(db, [pid], TODAY, NOW)
    assert result["week"]["scheduled"] == 4 and result["week"]["adherence"] == 75.0
    assert result["month"]["scheduled"] == 5 and result["month"]["adherence"] == 60.0
    assert len(result["daily"]) == 30
    assert result["daily"][-1]["date"] == TODAY
    assert result["daily"][0]["adherence"] is None


def test_early_confirmation_counts_and_never_exceeds_100(setup, db):
    pid = setup["patient_id"]
    db.query(MedicineDose).delete()
    add(db, pid, TODAY, 20, "taken")  # taken before its scheduled time
    db.commit()
    s = analytics.summarize(db, [pid], TODAY, TODAY, NOW)
    assert s["scheduled"] == 1 and s["adherence"] == 100.0


def test_adherence_and_dashboard_endpoints(client, setup):
    sid = setup["schedule"]["id"]
    client.post(
        "/api/v1/device-events",
        headers=setup["device_key"],
        json={"event_id": "evt-9000", "device_id": "MED-001", "event_type": "medicine_taken", "schedule_id": sid},
    )
    r = client.get(f"/api/v1/analytics/patients/{setup['patient_id']}/adherence", headers=setup["auth"])
    assert r.status_code == 200
    assert r.json()["today"]["taken"] == 1
    assert "not a clinical assessment" in r.json()["note"]

    dash = client.get("/api/v1/dashboard", headers=setup["auth"]).json()
    assert dash["summary"]["patients"] == 1
    assert dash["summary"]["taken"] >= 1
    assert dash["summary"]["devices_total"] == 1
    assert dash["patients"][0]["device"]["device_uid"] == "MED-001"
    assert dash["activity"][0]["event_type"] == "medicine_taken"
    assert dash["alerts"][0]["type"] == "medicine_taken"
    assert len(dash["week"]) == 7
