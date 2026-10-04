"""Background engine tick: materialize doses, mark due/missed, detect offline devices.

Runs inside the API process. A Postgres advisory lock makes concurrent ticks (e.g. two
processes) a no-op, and every transition is a guarded row update with unique dedupe keys,
so a repeated tick can never double-notify.
"""

import asyncio
import logging
from datetime import UTC, datetime

from sqlalchemy import text

from app.config import get_settings
from app.database import SessionLocal
from app.services import devices, doses
from app.services.system import get_config

log = logging.getLogger(__name__)
LOCK_ID = 7_401_001
state: dict[str, datetime | bool | None] = {"last_tick_at": None, "running": False}


def tick(now: datetime | None = None) -> bool:
    """Run one engine pass. Returns False if another tick holds the lock."""
    now = now or datetime.now(UTC)
    with SessionLocal() as db:
        if not db.scalar(text("SELECT pg_try_advisory_xact_lock(:id)"), {"id": LOCK_ID}):
            return False
        cfg = get_config(db)
        doses.materialize(db, now)
        db.flush()
        doses.advance(db, now, cfg)
        devices.check_offline(db, now, cfg)
        db.commit()
    state["last_tick_at"] = now
    return True


async def run_forever() -> None:
    interval = get_settings().scheduler_interval_seconds
    state["running"] = True
    try:
        while True:
            try:
                await asyncio.to_thread(tick)
            except Exception:
                log.exception("scheduler tick failed")
            await asyncio.sleep(interval)
    finally:
        state["running"] = False
