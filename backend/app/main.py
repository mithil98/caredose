import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.v1 import admin, analytics, auth, devices, doses, events, medicines, notifications, patients, schedules, ws
from app.config import get_settings
from app.database import SessionLocal
from app.services.realtime import hub
from app.workers import scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    hub.loop = asyncio.get_running_loop()
    task = asyncio.create_task(scheduler.run_forever()) if get_settings().scheduler_enabled else None
    yield
    if task:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
    hub.loop = None


settings = get_settings()
app = FastAPI(
    title="Smart Medicine Caretaker API",
    version="1.0.0",
    description="Caretaker monitoring platform. Device-facing endpoints authenticate with `X-Device-Key`.",
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/v1/openapi.json",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Device-Key"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next) -> Response:  # noqa: ANN001
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("Cache-Control", "no-store")
    return response


api = APIRouter(prefix="/api/v1")
for module in (auth, patients, medicines, schedules, devices, events, doses, notifications, analytics, admin, ws):
    api.include_router(module.router)


@api.get("/health", tags=["system"])
def health() -> dict[str, str]:
    with SessionLocal() as db:
        db.execute(text("SELECT 1"))
    return {"status": "ok"}


app.include_router(api)
