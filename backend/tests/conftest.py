"""Tests run against a real PostgreSQL database (TEST_DATABASE_URL), migrated with Alembic."""

import os
from pathlib import Path

from dotenv import dotenv_values

_env = dotenv_values(Path(__file__).resolve().parents[2] / ".env")
_test_url = os.environ.get("TEST_DATABASE_URL") or _env.get("TEST_DATABASE_URL")
if not _test_url:
    raise RuntimeError("Set TEST_DATABASE_URL (see .env.example)")
os.environ["DATABASE_URL"] = _test_url
os.environ["SCHEDULER_ENABLED"] = "false"

import pytest  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from alembic import command  # noqa: E402
from app.database import Base, SessionLocal, engine  # noqa: E402
from app.deps import auth_limit, device_limit, refresh_limit  # noqa: E402
from app.main import app  # noqa: E402
from app.services import push  # noqa: E402


class FakePushProvider:
    """Stands in for the browser push service; records what would be delivered."""

    def __init__(self) -> None:
        self.sent: list[tuple[str, dict]] = []
        self.fail_with: Exception | None = None

    def send(self, sub, payload, *, urgency, ttl):  # noqa: ANN001
        if self.fail_with:
            raise self.fail_with
        self.sent.append((sub.endpoint, payload))


@pytest.fixture(scope="session", autouse=True)
def migrated_db():
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public"))
    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
def clean_db(migrated_db):
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    auth_limit.reset()
    device_limit.reset()
    refresh_limit.reset()
    yield


@pytest.fixture(autouse=True)
def fake_push(monkeypatch):
    fake = FakePushProvider()
    monkeypatch.setattr(push, "provider", fake)
    monkeypatch.setattr(push, "sync_delivery", True)
    return fake


@pytest.fixture
def db():
    with SessionLocal() as session:
        yield session


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def register(client: TestClient, email: str = "care@example.com", name: str = "Care Taker") -> dict:
    r = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "correct-horse-1", "full_name": name, "timezone": "Asia/Kolkata"},
    )
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def auth(client):
    return register(client)


@pytest.fixture
def admin_auth(client, db):
    from app.services.auth import create_user

    create_user(db, email="admin@example.com", password="admin-pass-1", full_name="Admin", role="admin", timezone="UTC")
    db.commit()
    r = client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "admin-pass-1"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def setup(client, auth):
    """A patient with one medicine, a device (with key) and an 8 PM schedule."""
    patient = client.post("/api/v1/patients", headers=auth, json={"full_name": "Rahul", "timezone": "Asia/Kolkata"})
    pid = patient.json()["id"]
    med = client.post(
        f"/api/v1/patients/{pid}/medicines",
        headers=auth,
        json={"name": "Medicine C", "dose_quantity": 1, "dose_unit": "tablet", "instructions": "After food"},
    ).json()
    sched = client.post(
        f"/api/v1/patients/{pid}/schedules",
        headers=auth,
        json={
            "medicine_id": med["id"],
            "time_of_day": "20:00",
            "period": "night",
            "days_of_week": [1, 2, 3, 4, 5, 6, 7],
        },
    ).json()
    dev = client.post("/api/v1/devices", headers=auth, json={"device_uid": "MED-001", "patient_id": pid}).json()
    return {
        "auth": auth,
        "patient_id": pid,
        "medicine": med,
        "schedule": sched,
        "device_key": {"X-Device-Key": dev["device_key"]},
    }
