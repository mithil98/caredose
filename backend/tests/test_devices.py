from datetime import UTC, datetime, timedelta

from sqlalchemy import text

from app.models import Device, Notification
from app.services.devices import status_of
from app.services.system import get_config
from app.workers.scheduler import tick


def test_register_device_returns_key_once_and_stores_hash(client, auth, db):
    r = client.post("/api/v1/devices", headers=auth, json={"device_uid": "med-002", "name": "Kitchen"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["device"]["device_uid"] == "MED-002"
    assert body["device"]["status"] == "unregistered"
    key = body["device_key"]
    stored = db.query(Device).one()
    assert key not in stored.key_hash and len(stored.key_hash) == 64
    assert "device_key" not in client.get("/api/v1/devices/MED-002", headers=auth).json()

    assert client.post("/api/v1/devices", headers=auth, json={"device_uid": "MED-002"}).status_code == 409
    assert client.post("/api/v1/devices", headers=auth, json={"device_uid": "x"}).status_code == 422


def test_heartbeat_updates_last_seen_and_firmware(client, setup):
    r = client.post(
        "/api/v1/devices/MED-001/heartbeat",
        headers=setup["device_key"],
        json={"device_id": "MED-001", "firmware_version": "1.0.0", "signal_strength": 18},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "online"
    dev = client.get("/api/v1/devices/MED-001", headers=setup["auth"]).json()
    assert dev["status"] == "online"
    assert dev["firmware_version"] == "1.0.0"
    assert dev["signal_strength"] == 18
    assert dev["last_seen_at"] is not None


def test_device_auth(client, setup):
    url = "/api/v1/devices/MED-001/heartbeat"
    assert client.post(url, json={}).status_code == 401
    assert client.post(url, headers={"X-Device-Key": "dk_wrong"}, json={}).status_code == 401
    # a caretaker JWT is not a device credential
    assert client.post(url, headers=setup["auth"], json={}).status_code == 401
    assert client.post(url, headers=setup["device_key"], json={"device_id": "MED-999"}).status_code == 422
    client.put("/api/v1/devices/MED-001", headers=setup["auth"], json={"is_active": False})
    assert client.post(url, headers=setup["device_key"], json={}).status_code == 403


def test_rotate_key_invalidates_old_key(client, setup):
    r = client.post("/api/v1/devices/MED-001/rotate-key", headers=setup["auth"])
    new_key = r.json()["device_key"]
    url = "/api/v1/devices/MED-001/heartbeat"
    assert client.post(url, headers=setup["device_key"], json={}).status_code == 401
    assert client.post(url, headers={"X-Device-Key": new_key}, json={}).status_code == 200


def test_status_thresholds(db, setup):
    cfg = get_config(db)
    d = db.query(Device).one()
    now = datetime.now(UTC)
    assert status_of(d, cfg, now) == "unregistered"
    d.last_seen_at = now - timedelta(minutes=1)
    assert status_of(d, cfg, now) == "online"
    d.last_seen_at = now - timedelta(minutes=cfg.device_warning_after_minutes + 1)
    assert status_of(d, cfg, now) == "warning"
    d.last_seen_at = now - timedelta(minutes=cfg.device_offline_after_minutes + 1)
    assert status_of(d, cfg, now) == "offline"
    d.reported_state = "error"
    assert status_of(d, cfg, now) == "error"


def test_offline_detected_once_and_restored(client, setup, db, fake_push):
    client.post(
        "/api/v1/notifications/push-subscription",
        headers=setup["auth"],
        json={"endpoint": "https://fcm.googleapis.com/fcm/send/abc", "keys": {"p256dh": "B" * 87, "auth": "A" * 22}},
    )
    client.post("/api/v1/devices/MED-001/heartbeat", headers=setup["device_key"], json={})
    db.execute(text("UPDATE devices SET last_seen_at = now() - interval '20 minutes'"))
    db.commit()

    assert tick()
    assert tick()  # second pass must not alert again
    offline = db.query(Notification).filter_by(type="device_offline").all()
    assert len(offline) == 1
    assert "MED-001" in offline[0].body
    assert any(p["type"] == "device_offline" for _, p in fake_push.sent)
    assert client.get("/api/v1/devices/MED-001", headers=setup["auth"]).json()["status"] == "offline"

    client.post("/api/v1/devices/MED-001/heartbeat", headers=setup["device_key"], json={})
    assert db.query(Notification).filter_by(type="device_online").count() == 1
    assert client.get("/api/v1/devices/MED-001", headers=setup["auth"]).json()["status"] == "online"
    types = [e["event_type"] for e in client.get("/api/v1/device-events", headers=setup["auth"]).json()["items"]]
    assert "device_offline" in types and "device_online" in types


def test_device_error_and_offline_events(client, setup, db):
    key = setup["device_key"]
    r = client.post(
        "/api/v1/device-events",
        headers=key,
        json={
            "event_id": "err-0001",
            "device_id": "MED-001",
            "event_type": "device_error",
            "metadata": {"error": "Servo 2 jammed"},
        },
    )
    assert r.status_code == 201, r.text
    dev = client.get("/api/v1/devices/MED-001", headers=setup["auth"]).json()
    assert dev["status"] == "error" and dev["last_error"] == "Servo 2 jammed"
    assert db.query(Notification).filter_by(type="device_error").count() == 1
    client.post("/api/v1/devices/MED-001/heartbeat", headers=key, json={"status": "ok"})
    assert client.get("/api/v1/devices/MED-001", headers=setup["auth"]).json()["status"] == "online"

    client.post(
        "/api/v1/device-events",
        headers=key,
        json={"event_id": "off-0001", "device_id": "MED-001", "event_type": "device_offline"},
    )
    assert client.get("/api/v1/devices/MED-001", headers=setup["auth"]).json()["status"] == "offline"
    assert db.query(Notification).filter_by(type="device_offline").count() == 1
    client.post("/api/v1/devices/MED-001/heartbeat", headers=key, json={})
    assert db.query(Notification).filter_by(type="device_online").count() == 1


def test_device_config_lists_schedules(client, setup):
    r = client.get("/api/v1/devices/MED-001/config", headers=setup["device_key"])
    assert r.status_code == 200
    body = r.json()
    assert body["timezone"] == "Asia/Kolkata"
    assert body["patient_assigned"] is True
    assert body["schedules"][0]["time_of_day"] == "20:00"
    assert body["schedules"][0]["schedule_id"] == setup["schedule"]["id"]
    assert client.get("/api/v1/devices/MED-001/config").status_code == 401
