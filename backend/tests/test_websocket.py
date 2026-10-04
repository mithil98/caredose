import pytest
from starlette.websockets import WebSocketDisconnect


def test_websocket_rejects_missing_or_bad_token(client):
    with client.websocket_connect("/api/v1/ws") as ws:
        ws.send_json({"type": "auth", "token": "not-a-jwt"})
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_text()
    assert exc.value.code == 4401


def test_websocket_streams_live_changes_to_the_caretaker(client, setup):
    token = setup["auth"]["Authorization"].split()[1]
    with client.websocket_connect("/api/v1/ws") as ws:
        ws.send_json({"type": "auth", "token": token})
        assert ws.receive_json() == {"type": "ready"}
        ws.send_text('{"type":"ping"}')
        assert ws.receive_json() == {"type": "pong"}

        r = client.post(
            "/api/v1/device-events",
            headers=setup["device_key"],
            json={
                "event_id": "ws-000001",
                "device_id": "MED-001",
                "event_type": "medicine_dispensed",
                "schedule_id": setup["schedule"]["id"],
            },
        )
        assert r.status_code == 201
        seen = {ws.receive_json()["type"] for _ in range(4)}
        assert {"event", "dose", "notification", "device"} <= seen


def test_other_caretakers_do_not_receive_updates(client, setup):
    from tests.conftest import register

    other = register(client, "other@example.com", "Other")
    with client.websocket_connect("/api/v1/ws") as ws:
        ws.send_json({"type": "auth", "token": other["Authorization"].split()[1]})
        assert ws.receive_json() == {"type": "ready"}
        client.post(
            "/api/v1/device-events",
            headers=setup["device_key"],
            json={"event_id": "ws-000002", "device_id": "MED-001", "event_type": "device_online"},
        )
        ws.send_text('{"type":"ping"}')
        assert ws.receive_json() == {"type": "pong"}  # nothing else was queued for this user
