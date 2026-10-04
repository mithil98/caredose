from datetime import UTC, datetime, timedelta

from app.models import MedicineEvent, Notification

SUB = {"endpoint": "https://fcm.googleapis.com/fcm/send/sub-1", "keys": {"p256dh": "B" * 87, "auth": "A" * 22}}


def event(setup, event_type, event_id, **extra):
    return {"event_id": event_id, "device_id": "MED-001", "event_type": event_type, **extra}


def post(client, setup, body):
    return client.post("/api/v1/device-events", headers=setup["device_key"], json=body)


def test_full_dose_lifecycle_generates_notifications_and_push(client, setup, db, fake_push):
    client.post("/api/v1/notifications/push-subscription", headers=setup["auth"], json=SUB)
    sid = setup["schedule"]["id"]
    for i, kind in enumerate(("medicine_due", "medicine_dispensed", "medicine_taken")):
        r = post(client, setup, event(setup, kind, f"evt-000{i}", schedule_id=sid, metadata={"slot": "night"}))
        assert r.status_code == 201, r.text
        assert r.json()["result"] == "applied"
    assert r.json()["dose_status"] == "taken"

    types = [n.type for n in db.query(Notification).order_by(Notification.id)]
    assert types == ["medicine_due", "medicine_dispensed", "medicine_taken"]
    assert [p["type"] for _, p in fake_push.sent] == types
    first = fake_push.sent[0][1]
    assert first["title"] == "💊 Medicine Due"
    assert "Rahul's night medicine is due now" in first["body"]
    assert first["url"].startswith(f"/patients/{setup['patient_id']}?dose=")

    history = client.get("/api/v1/doses", headers=setup["auth"], params={"patient_id": setup["patient_id"]}).json()
    assert history["total"] == 1
    dose = history["items"][0]
    assert dose["status"] == "taken"
    assert dose["device_uid"] == "MED-001"
    assert dose["dispensed_at"] and dose["taken_at"]


def test_duplicate_event_id_is_idempotent(client, setup, db):
    body = event(setup, "medicine_dispensed", "retry-0001", schedule_id=setup["schedule"]["id"])
    first = post(client, setup, body)
    second = post(client, setup, body)
    assert first.status_code == 201 and second.status_code == 200
    assert second.json()["duplicate"] is True
    assert second.json()["id"] == first.json()["id"]
    assert db.query(MedicineEvent).filter_by(source="device").count() == 1
    assert db.query(Notification).filter_by(type="medicine_dispensed").count() == 1


def test_same_event_id_from_another_device_is_distinct(client, setup, db):
    other = client.post("/api/v1/devices", headers=setup["auth"], json={"device_uid": "MED-002"}).json()
    body = {"event_id": "boot-000001", "event_type": "device_online"}
    assert post(client, setup, {**body, "device_id": "MED-001"}).status_code == 201
    r = client.post(
        "/api/v1/device-events", headers={"X-Device-Key": other["device_key"]}, json={**body, "device_id": "MED-002"}
    )
    assert r.status_code == 201
    assert db.query(MedicineEvent).count() == 2


def test_event_without_ids_matches_nearest_open_dose(client, setup):
    sid = setup["schedule"]["id"]
    post(client, setup, event(setup, "medicine_dispensed", "evt-1000", schedule_id=sid))
    r = post(client, setup, event(setup, "medicine_taken", "evt-1001"))
    assert r.json()["result"] == "applied"
    assert r.json()["dose_status"] == "taken"


def test_unmatched_and_out_of_order_events_are_stored_not_applied(client, setup):
    sid = setup["schedule"]["id"]
    sched = {**setup["schedule"], "is_active": False}
    client.put(f"/api/v1/schedules/{sid}", headers=setup["auth"], json=sched)  # no open doses left
    r = post(client, setup, event(setup, "medicine_taken", "evt-2000"))
    assert r.status_code == 201
    assert r.json()["result"] == "unmatched"
    assert (
        post(client, setup, event(setup, "medicine_due", "evt-2003", schedule_id=sid)).json()["result"] == "unmatched"
    )

    client.put(f"/api/v1/schedules/{sid}", headers=setup["auth"], json={**sched, "is_active": True})
    post(client, setup, event(setup, "medicine_taken", "evt-2001", schedule_id=sid))
    late = post(client, setup, event(setup, "medicine_dispensed", "evt-2002", schedule_id=sid))
    assert late.json()["result"] == "ignored"
    assert late.json()["dose_status"] == "taken"


def test_patient_id_from_device_is_never_trusted(client, setup):
    other_pid = client.post("/api/v1/patients", headers=setup["auth"], json={"full_name": "Asha"}).json()["id"]
    r = post(
        client,
        setup,
        event(setup, "medicine_dispensed", "evt-3000", schedule_id=setup["schedule"]["id"], patient_id=other_pid),
    )
    assert r.json()["result"] == "applied"
    assert client.get("/api/v1/doses", headers=setup["auth"], params={"patient_id": other_pid}).json()["total"] == 0


def test_event_validation(client, setup):
    assert post(client, setup, event(setup, "medicine_exploded", "evt-4000")).status_code == 422
    assert post(client, setup, event(setup, "medicine_due", "x")).status_code == 422
    future = (datetime.now(UTC) + timedelta(hours=2)).isoformat()
    assert post(client, setup, event(setup, "medicine_due", "evt-4001", event_time=future)).status_code == 422
    assert client.post("/api/v1/device-events", json=event(setup, "medicine_due", "evt-4002")).status_code == 401
    big = {f"k{i}": "v" for i in range(30)}
    assert post(client, setup, event(setup, "device_online", "evt-4003", metadata=big)).status_code == 422


def test_unassigned_device_cannot_report_medicine_events(client, setup):
    client.put("/api/v1/devices/MED-001", headers=setup["auth"], json={"patient_id": None})
    assert post(client, setup, event(setup, "medicine_due", "evt-5000")).status_code == 409


def test_caretaker_can_confirm_or_cancel_dose(client, setup):
    sid = setup["schedule"]["id"]
    dose_id = post(client, setup, event(setup, "medicine_due", "evt-6000", schedule_id=sid)).json()["dose_id"]
    r = client.patch(f"/api/v1/doses/{dose_id}", headers=setup["auth"], json={"status": "taken"})
    assert r.status_code == 200 and r.json()["status"] == "taken"
    again = client.patch(f"/api/v1/doses/{dose_id}", headers=setup["auth"], json={"status": "cancelled"})
    assert again.status_code == 409


def test_history_filters_pagination_and_csv(client, setup):
    sid = setup["schedule"]["id"]
    post(client, setup, event(setup, "medicine_taken", "evt-7000", schedule_id=sid))
    base = {"patient_id": setup["patient_id"]}
    assert client.get("/api/v1/doses", headers=setup["auth"], params={**base, "status": "taken"}).json()["total"] == 1
    assert client.get("/api/v1/doses", headers=setup["auth"], params={**base, "status": "missed"}).json()["total"] == 0
    assert client.get("/api/v1/doses", headers=setup["auth"], params={"status": "bogus"}).status_code == 422
    page = client.get("/api/v1/doses", headers=setup["auth"], params={"page": 2, "page_size": 1}).json()
    assert page["items"] == [] and page["total"] == 1
    events = client.get("/api/v1/device-events", headers=setup["auth"], params={"event_type": "medicine_taken"}).json()
    assert events["total"] == 1 and events["items"][0]["device_uid"] == "MED-001"
    csv = client.get("/api/v1/doses/export.csv", headers=setup["auth"])
    assert csv.headers["content-type"].startswith("text/csv")
    assert "Medicine C" in csv.text and "taken" in csv.text


def test_read_single_dose_respects_ownership(client, setup):
    from tests.conftest import register

    r = post(client, setup, event(setup, "medicine_dispensed", "evt-8100", schedule_id=setup["schedule"]["id"]))
    dose_id = r.json()["dose_id"]
    dose = client.get(f"/api/v1/doses/{dose_id}", headers=setup["auth"])
    assert dose.status_code == 200
    assert dose.json()["status"] == "dispensed" and dose.json()["device_uid"] == "MED-001"
    other = register(client, "other@example.com", "Other")
    assert client.get(f"/api/v1/doses/{dose_id}", headers=other).status_code == 404
