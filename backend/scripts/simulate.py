"""Command-line device simulator. Speaks exactly the HTTP contract a real dispenser will use.

Examples (key printed by `python -m app.seed` or by "Generate key" in the web simulator):

    python scripts/simulate.py --key dk_xxx heartbeat
    python scripts/simulate.py --key dk_xxx config
    python scripts/simulate.py --key dk_xxx due --slot night
    python scripts/simulate.py --key dk_xxx dispensed --schedule 3
    python scripts/simulate.py --key dk_xxx taken
    python scripts/simulate.py --key dk_xxx missed --slot morning
    python scripts/simulate.py --key dk_xxx error --message "Servo 2 jammed"
    python scripts/simulate.py --key dk_xxx offline
    python scripts/simulate.py --key dk_xxx taken --retry 3      # same event_id 3x -> stored once
    python scripts/simulate.py --key dk_xxx run                  # heartbeat every 60 s

Env vars: CARETAKER_API (default http://127.0.0.1:8000/api/v1), DEVICE_ID, DEVICE_KEY.
"""

import argparse
import json
import os
import time
import uuid
from datetime import UTC, datetime

import httpx

EVENTS = {
    "due": "medicine_due",
    "dispensed": "medicine_dispensed",
    "taken": "medicine_taken",
    "missed": "medicine_missed",
    "online": "device_online",
    "offline": "device_offline",
    "error": "device_error",
}


def show(r: httpx.Response) -> None:
    print(r.status_code, json.dumps(r.json(), indent=2) if r.content else "")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("action", choices=[*EVENTS, "heartbeat", "config", "run"])
    p.add_argument("--api", default=os.environ.get("CARETAKER_API", "http://127.0.0.1:8000/api/v1"))
    p.add_argument("--device", default=os.environ.get("DEVICE_ID", "MED-001"))
    p.add_argument("--key", default=os.environ.get("DEVICE_KEY"), required="DEVICE_KEY" not in os.environ)
    p.add_argument("--schedule", type=int, help="schedule_id from /config")
    p.add_argument("--dose", type=int, help="dose_id")
    p.add_argument("--slot", choices=["morning", "afternoon", "evening", "night"])
    p.add_argument("--message", help="error text for the error action")
    p.add_argument("--firmware", default="1.0.0-sim")
    p.add_argument("--event-id", help="reuse an event id (idempotency test)")
    p.add_argument("--retry", type=int, default=1, help="send the same event N times")
    a = p.parse_args()

    with httpx.Client(base_url=a.api, headers={"X-Device-Key": a.key}, timeout=15) as http:
        if a.action == "config":
            return show(http.get(f"/devices/{a.device}/config"))
        if a.action in ("heartbeat", "run"):
            while True:
                show(
                    http.post(
                        f"/devices/{a.device}/heartbeat",
                        json={
                            "device_id": a.device,
                            "timestamp": datetime.now(UTC).isoformat(),
                            "firmware_version": a.firmware,
                            "signal_strength": 20,
                        },
                    )
                )
                if a.action == "heartbeat":
                    return None
                time.sleep(60)
        body = {
            "event_id": a.event_id or f"sim-{uuid.uuid4().hex[:20]}",
            "device_id": a.device,
            "event_type": EVENTS[a.action],
            "schedule_id": a.schedule,
            "dose_id": a.dose,
            "event_time": datetime.now(UTC).isoformat(),
            "metadata": {k: v for k, v in {"slot": a.slot, "error": a.message, "source": "cli-simulator"}.items() if v},
        }
        for _ in range(a.retry):
            show(http.post("/device-events", json=body))
    return None


if __name__ == "__main__":
    main()
