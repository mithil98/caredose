"""Serverless (Vercel) deployment hooks: cron-driven engine tick and hosted Postgres URLs."""

from app.config import Settings, get_settings


def test_engine_tick_requires_cron_secret(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "cron_secret", "")
    assert client.get("/api/v1/internal/engine/tick").status_code == 503

    monkeypatch.setattr(get_settings(), "cron_secret", "s3cret-value")
    assert client.get("/api/v1/internal/engine/tick").status_code == 401
    assert client.get("/api/v1/internal/engine/tick", headers={"Authorization": "Bearer nope"}).status_code == 401
    ok = client.get("/api/v1/internal/engine/tick", headers={"Authorization": "Bearer s3cret-value"})
    assert ok.status_code == 200 and ok.json() == {"ran": True}


def test_hosted_postgres_urls_use_psycopg_driver(monkeypatch):
    s = get_settings()
    base = {"jwt_secret": s.jwt_secret, "device_api_secret": s.device_api_secret}
    for raw in (
        "postgres://u:p@host.neon.tech/db?sslmode=require",
        "postgresql://u:p@host.neon.tech/db?sslmode=require",
    ):
        assert (
            Settings(database_url=raw, **base).database_url
            == "postgresql+psycopg://u:p@host.neon.tech/db?sslmode=require"
        )
    unchanged = "postgresql+psycopg://u:p@127.0.0.1:5432/db"
    assert Settings(database_url=unchanged, **base).database_url == unchanged
