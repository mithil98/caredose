import base64
import json
import os

import http_ece
import pytest
import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from app.config import get_settings
from app.models import PushSubscription
from app.services.push import PushGone, WebPushProvider

SUB = {
    "endpoint": "https://fcm.googleapis.com/fcm/send/sub-1",
    "expirationTime": None,
    "keys": {"p256dh": "B" * 87, "auth": "A" * 22},
}


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def test_subscription_lifecycle(client, auth, db):
    status = client.get("/api/v1/notifications/push-status", headers=auth).json()
    assert status["configured"] is True and status["vapid_public_key"] and status["subscriptions"] == 0
    assert "vapid_private_key" not in json.dumps(status)

    assert client.post("/api/v1/notifications/push-subscription", headers=auth, json=SUB).status_code == 201
    assert client.post("/api/v1/notifications/push-subscription", headers=auth, json=SUB).status_code == 201
    assert db.query(PushSubscription).count() == 1  # upsert by endpoint

    r = client.request(
        "DELETE", "/api/v1/notifications/push-subscription", headers=auth, json={"endpoint": SUB["endpoint"]}
    )
    assert r.status_code == 204
    assert db.query(PushSubscription).count() == 0


@pytest.mark.parametrize(
    "bad",
    [
        {**SUB, "endpoint": "http://insecure.example.com/x"},
        {**SUB, "endpoint": "javascript:alert(1)"},
        {**SUB, "endpoint": "https://169.254.169.254/latest/meta-data"},
        {**SUB, "endpoint": "https://fcm.googleapis.com.evil.example/x"},
        {**SUB, "keys": {"p256dh": "short", "auth": "A" * 22}},
        {**SUB, "keys": {"p256dh": "B" * 87, "auth": "not base64!!"}},
        {"endpoint": SUB["endpoint"]},
    ],
)
def test_subscription_validation(client, auth, bad):
    assert client.post("/api/v1/notifications/push-subscription", headers=auth, json=bad).status_code == 422


def test_test_notification_reports_real_results(client, auth, fake_push):
    assert client.post("/api/v1/notifications/test", headers=auth).status_code == 409  # nothing subscribed
    client.post("/api/v1/notifications/push-subscription", headers=auth, json=SUB)
    r = client.post("/api/v1/notifications/test", headers=auth)
    assert r.json() == {"sent": 1, "failed": 0, "errors": []}
    assert fake_push.sent[0][1]["type"] == "test"

    fake_push.fail_with = RuntimeError("push service rejected the message (500)")
    r = client.post("/api/v1/notifications/test", headers=auth)
    assert r.json()["sent"] == 0 and r.json()["failed"] == 1


def test_expired_subscription_is_removed(client, auth, db, fake_push):
    client.post("/api/v1/notifications/push-subscription", headers=auth, json=SUB)
    fake_push.fail_with = PushGone("410")
    client.post("/api/v1/notifications/test", headers=auth)
    assert db.query(PushSubscription).count() == 0


def test_renew_moves_subscription_without_session(client, auth, db):
    client.post("/api/v1/notifications/push-subscription", headers=auth, json=SUB)
    new = {**SUB, "endpoint": "https://fcm.googleapis.com/fcm/send/sub-2"}
    r = client.post(
        "/api/v1/notifications/push-subscription/renew", json={"old_endpoint": SUB["endpoint"], "subscription": new}
    )
    assert r.status_code == 201
    assert [s.endpoint for s in db.query(PushSubscription)] == [new["endpoint"]]
    unknown = {"old_endpoint": "https://fcm.googleapis.com/fcm/send/nope", "subscription": new}
    assert client.post("/api/v1/notifications/push-subscription/renew", json=unknown).status_code == 404


def test_push_not_configured_is_reported(client, auth, monkeypatch):
    monkeypatch.setattr(get_settings(), "vapid_private_key", "")
    assert client.post("/api/v1/notifications/push-subscription", headers=auth, json=SUB).status_code == 503
    assert client.post("/api/v1/notifications/test", headers=auth).status_code == 503


def test_web_push_provider_encrypts_and_signs(monkeypatch):
    """Real pywebpush path: VAPID-signed, aes128gcm-encrypted body the browser can decrypt."""
    receiver = ec.generate_private_key(ec.SECP256R1())
    auth_secret = os.urandom(16)
    p256dh = receiver.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    sub = PushSubscription(
        endpoint="https://fcm.googleapis.com/fcm/send/abc", p256dh=b64(p256dh), auth=b64(auth_secret)
    )
    captured = {}

    class Ok:
        status_code = 201
        text = ""
        headers = {}

    def fake_post(url, data=None, headers=None, timeout=None, **_):
        captured.update(url=url, data=data, headers=headers)
        return Ok()

    monkeypatch.setattr(requests, "post", fake_post)
    WebPushProvider().send(sub, {"title": "💊 Medicine Due", "url": "/patients/1"}, urgency="high", ttl=60)

    assert captured["url"] == sub.endpoint
    h = captured["headers"]
    assert h["Content-Encoding"] == "aes128gcm"
    assert h["Urgency"] == "high" and str(h["TTL"]) == "60"
    assert h["Authorization"].startswith("vapid t=") and f"k={get_settings().vapid_public_key}" in h["Authorization"]
    plain = http_ece.decrypt(captured["data"], private_key=receiver, auth_secret=auth_secret, version="aes128gcm")
    assert json.loads(plain) == {"title": "💊 Medicine Due", "url": "/patients/1"}


def test_web_push_provider_maps_gone(monkeypatch):
    class Gone:
        status_code = 410
        reason = "Gone"
        text = ""
        headers = {}

    monkeypatch.setattr(requests, "post", lambda *a, **k: Gone())
    sub = PushSubscription(
        endpoint="https://fcm.googleapis.com/fcm/send/x", p256dh=SUB["keys"]["p256dh"], auth=SUB["keys"]["auth"]
    )
    receiver = ec.generate_private_key(ec.SECP256R1())
    sub.p256dh = b64(
        receiver.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    )
    sub.auth = b64(os.urandom(16))
    with pytest.raises(PushGone):
        WebPushProvider().send(sub, {"t": 1}, urgency="normal", ttl=60)


def test_notification_center_read_flow(client, setup):
    sid = setup["schedule"]["id"]
    for i, kind in enumerate(("medicine_dispensed", "medicine_taken")):
        client.post(
            "/api/v1/device-events",
            headers=setup["device_key"],
            json={"event_id": f"evt-80{i}0", "device_id": "MED-001", "event_type": kind, "schedule_id": sid},
        )
    auth = setup["auth"]
    page = client.get("/api/v1/notifications", headers=auth).json()
    assert page["total"] == 2 and page["unread"] == 2
    assert page["items"][0]["patient_name"] == "Rahul"
    first = page["items"][0]["id"]
    assert client.post(f"/api/v1/notifications/{first}/read", headers=auth).status_code == 204
    assert client.get("/api/v1/notifications", headers=auth).json()["unread"] == 1
    assert client.get("/api/v1/notifications", headers=auth, params={"unread_only": True}).json()["total"] == 1
    client.post("/api/v1/notifications/read-all", headers=auth)
    assert client.get("/api/v1/notifications", headers=auth).json()["unread"] == 0
