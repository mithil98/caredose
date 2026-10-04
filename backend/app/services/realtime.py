"""WebSocket hub for live dashboard updates and the post-commit outbox.

Services never talk to sockets or push providers directly: they call `enqueue_ws` /
`enqueue_push`, and the messages are dispatched only after the DB transaction commits.
"""

import asyncio
import json
import logging
from collections import defaultdict
from typing import Any

from fastapi import WebSocket
from sqlalchemy import event
from sqlalchemy.orm import Session

log = logging.getLogger(__name__)


class Hub:
    # ponytail: in-process registry, one API worker only. Use Postgres LISTEN/NOTIFY or
    # Redis pub/sub here when running more than one backend process.
    def __init__(self) -> None:
        self.loop: asyncio.AbstractEventLoop | None = None
        self.by_user: dict[int, set[WebSocket]] = defaultdict(set)
        self.admins: set[WebSocket] = set()

    @property
    def connection_count(self) -> int:
        return sum(len(s) for s in self.by_user.values())

    def add(self, user_id: int, is_admin: bool, ws: WebSocket) -> None:
        self.by_user[user_id].add(ws)
        if is_admin:
            self.admins.add(ws)

    def remove(self, user_id: int, ws: WebSocket) -> None:
        self.by_user[user_id].discard(ws)
        self.admins.discard(ws)
        if not self.by_user[user_id]:
            del self.by_user[user_id]

    def publish(self, user_ids: frozenset[int], message: dict[str, Any]) -> None:
        """Thread-safe: schedule delivery on the server event loop."""
        if self.loop is None or self.loop.is_closed():
            return
        asyncio.run_coroutine_threadsafe(self._send(user_ids, message), self.loop)

    async def _send(self, user_ids: frozenset[int], message: dict[str, Any]) -> None:
        targets = set(self.admins)
        for uid in user_ids:
            targets |= self.by_user.get(uid, set())
        data = json.dumps(message, default=str)
        for ws in targets:
            try:
                await ws.send_text(data)
            except Exception:  # closed socket; the receive loop cleans it up
                log.debug("websocket send failed", exc_info=True)


hub = Hub()


def enqueue_ws(db: Session, user_ids: set[int] | list[int], message: dict[str, Any]) -> None:
    db.info.setdefault("outbox", []).append(("ws", frozenset(user_ids), message))


def enqueue_push(db: Session, notification_id: int) -> None:
    db.info.setdefault("outbox", []).append(("push", notification_id, None))


@event.listens_for(Session, "after_commit")
def _dispatch(session: Session) -> None:
    from app.services import push  # local import: push imports database/session

    for kind, target, message in session.info.pop("outbox", []):
        if kind == "ws":
            hub.publish(target, message)
        else:
            push.schedule_delivery(target)


@event.listens_for(Session, "after_rollback")
def _discard(session: Session) -> None:
    session.info.pop("outbox", None)
