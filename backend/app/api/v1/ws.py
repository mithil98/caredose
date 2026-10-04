"""Live dashboard channel. The browser authenticates with its access token in the first
message (keeps tokens out of URLs/logs), then receives small "something changed" messages."""

import asyncio
import contextlib
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.database import SessionLocal
from app.models import User
from app.services.auth import decode_token
from app.services.realtime import hub

router = APIRouter()
AUTH_TIMEOUT_SECONDS = 10


def _user_for(token: str) -> User | None:
    user_id = decode_token(token, "access")
    if user_id is None:
        return None
    with SessionLocal() as db:
        user = db.get(User, user_id)
        return user if user and user.is_active else None


@router.websocket("/ws")
async def live_updates(ws: WebSocket) -> None:
    await ws.accept()
    try:
        first = json.loads(await asyncio.wait_for(ws.receive_text(), AUTH_TIMEOUT_SECONDS))
        user = await asyncio.to_thread(_user_for, str(first.get("token", ""))) if first.get("type") == "auth" else None
    except WebSocketDisconnect:
        return  # client left before authenticating
    except (TimeoutError, ValueError, AttributeError):
        user = None
    if user is None:
        with contextlib.suppress(WebSocketDisconnect, RuntimeError):
            await ws.close(code=4401, reason="unauthorized")
        return

    hub.add(user.id, user.role == "admin", ws)
    try:
        await ws.send_text(json.dumps({"type": "ready"}))
        while True:
            message = await ws.receive_text()
            if message == '{"type":"ping"}':
                await ws.send_text('{"type":"pong"}')
    except WebSocketDisconnect:
        pass
    finally:
        hub.remove(user.id, ws)
