"""Pydantic request/response schemas (the API contract)."""

import re
from datetime import UTC, date, datetime, time
from decimal import Decimal
from typing import Annotated, Any, Generic, Literal, TypeVar
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

from app.config import get_settings

_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


def _clean(value: str) -> str:
    return _CONTROL.sub("", value).strip()


def _timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError("Unknown timezone") from None
    return value


def Text(max_length: int, min_length: int = 0) -> Any:  # noqa: N802 (type factory)
    """Trimmed, control-character-free string."""
    return Annotated[str, AfterValidator(_clean), Field(max_length=max_length), AfterValidator(_min(min_length))]


def _min(n: int):
    def check(value: str) -> str:
        if len(value) < n:
            raise ValueError("This field is required" if n == 1 else f"Must be at least {n} characters")
        return value

    return check


TimeZone = Annotated[str, AfterValidator(_timezone)]
Period = Literal["morning", "afternoon", "evening", "night"]
DoseStatus = Literal["scheduled", "due", "dispensed", "taken", "missed", "cancelled"]
DeviceStatus = Literal["online", "warning", "offline", "error", "unregistered"]
DeviceUid = Annotated[str, Field(pattern=r"^[A-Z0-9][A-Z0-9-]{2,31}$")]
Quantity = Annotated[Decimal, Field(gt=0, le=1000, max_digits=6, decimal_places=2)]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


S = TypeVar("S", bound=BaseModel)


def build(schema: type[S], obj: Any, **extra: Any) -> S:
    """Fill a schema from an ORM object's attributes plus computed extras."""
    data = {f: getattr(obj, f) for f in schema.model_fields if f not in extra}
    return schema.model_validate({**data, **extra})


T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


# ---------- auth / users ----------


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: Text(120, 1)
    timezone: TimeZone = "Asia/Kolkata"


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserOut(ORM):
    id: int
    email: str
    full_name: str
    role: str
    timezone: str
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class ProfileIn(BaseModel):
    full_name: Text(120, 1)
    timezone: TimeZone


class AdminUserCreateIn(RegisterIn):
    role: Literal["admin", "caretaker"] = "caretaker"


class AdminUserUpdateIn(BaseModel):
    full_name: Text(120, 1) | None = None
    role: Literal["admin", "caretaker"] | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)


class AdminUserOut(UserOut):
    patient_count: int = 0
    device_count: int = 0


# ---------- patients ----------


class PatientIn(BaseModel):
    full_name: Text(120, 1)
    date_of_birth: date | None = None
    contact_phone: Annotated[str, Field(pattern=r"^[+0-9 ()-]{6,32}$")] | None = None
    notes: Text(500) | None = None
    timezone: TimeZone = "Asia/Kolkata"
    is_active: bool = True
    # Only honoured for admins (re-assigning a patient to another caretaker).
    caretaker_id: int | None = None

    @field_validator("date_of_birth")
    @classmethod
    def _dob(cls, v: date | None) -> date | None:
        if v and not (date(1900, 1, 1) <= v <= datetime.now(UTC).date()):
            raise ValueError("Date of birth must be between 1900 and today")
        return v

    @field_validator("contact_phone", "notes", mode="before")
    @classmethod
    def _blank_to_none(cls, v: Any) -> Any:
        return None if isinstance(v, str) and not v.strip() else v


class PersonRef(ORM):
    id: int
    full_name: str


class DeviceBrief(BaseModel):
    id: int
    device_uid: str
    name: str | None
    status: DeviceStatus
    last_seen_at: datetime | None


class DayStats(BaseModel):
    scheduled: int = 0
    taken: int = 0
    missed: int = 0
    late: int = 0
    pending: int = 0
    total: int = 0
    adherence: float | None = None


class PatientOut(ORM):
    id: int
    full_name: str
    date_of_birth: date | None
    contact_phone: str | None
    notes: str | None
    timezone: str
    is_active: bool
    created_at: datetime
    caretaker: PersonRef
    devices: list[DeviceBrief] = []
    medicine_count: int = 0
    today: DayStats = DayStats()


# ---------- medicines / schedules ----------


class MedicineIn(BaseModel):
    name: Text(120, 1)
    generic_name: Text(120) | None = None
    dose_quantity: Quantity
    dose_unit: Annotated[str, AfterValidator(_clean), Field(pattern=r"^[A-Za-z ]{1,24}$")]
    instructions: Text(500) | None = None
    is_active: bool = True


class MedicineOut(ORM):
    id: int
    patient_id: int
    patient_name: str
    name: str
    generic_name: str | None
    dose_quantity: Decimal
    dose_unit: str
    instructions: str | None
    is_active: bool
    schedule_count: int = 0
    created_at: datetime
    updated_at: datetime


class ScheduleIn(BaseModel):
    medicine_id: int
    dose_quantity: Quantity | None = None
    time_of_day: time
    period: Period
    days_of_week: list[Annotated[int, Field(ge=1, le=7)]] = Field(min_length=1, max_length=7)
    start_date: date | None = None
    end_date: date | None = None
    is_active: bool = True

    @field_validator("time_of_day")
    @classmethod
    def _minute_precision(cls, v: time) -> time:
        return v.replace(second=0, microsecond=0, tzinfo=None)

    @field_validator("days_of_week")
    @classmethod
    def _unique_days(cls, v: list[int]) -> list[int]:
        return sorted(set(v))

    @model_validator(mode="after")
    def _dates(self) -> "ScheduleIn":
        if self.end_date and self.start_date and self.end_date < self.start_date:
            raise ValueError("End date must be on or after the start date")
        return self


class ScheduleOut(ORM):
    id: int
    patient_id: int
    patient_name: str
    medicine_id: int
    medicine_name: str
    dose_quantity: Decimal
    dose_unit: str
    time_of_day: time
    period: Period
    days_of_week: list[int]
    start_date: date
    end_date: date | None
    is_active: bool
    created_at: datetime


# ---------- doses / events ----------


class DoseOut(BaseModel):
    id: int
    patient_id: int
    patient_name: str
    patient_timezone: str
    schedule_id: int | None
    medicine_id: int | None
    medicine_name: str
    dose_quantity: Decimal
    dose_unit: str
    period: Period
    scheduled_for: datetime
    local_date: date
    status: DoseStatus
    due_at: datetime | None
    dispensed_at: datetime | None
    taken_at: datetime | None
    missed_at: datetime | None
    cancelled_at: datetime | None
    is_late: bool
    device_uid: str | None


class DoseUpdateIn(BaseModel):
    status: Literal["taken", "cancelled"]


class EventOut(BaseModel):
    id: int
    event_id: str
    source: str
    event_type: str
    result: str
    detail: str | None
    device_uid: str | None
    patient_id: int | None
    patient_name: str | None
    dose_id: int | None
    medicine_name: str | None
    period: str | None
    event_time: datetime
    received_at: datetime


# ---------- devices (caretaker side) ----------


class DeviceCreateIn(BaseModel):
    device_uid: DeviceUid
    name: Text(80) | None = None
    patient_id: int | None = None

    @field_validator("device_uid", mode="before")
    @classmethod
    def _upper(cls, v: Any) -> Any:
        return v.strip().upper() if isinstance(v, str) else v


class DeviceUpdateIn(BaseModel):
    name: Text(80) | None = None
    patient_id: int | None = None
    is_active: bool = True


class DeviceOut(BaseModel):
    id: int
    device_uid: str
    name: str | None
    patient: PersonRef | None
    owner: PersonRef
    status: DeviceStatus
    last_seen_at: datetime | None
    firmware_version: str | None
    signal_strength: int | None
    last_error: str | None
    offline_since: datetime | None
    is_active: bool
    created_at: datetime


class DeviceKeyOut(BaseModel):
    device: DeviceOut
    device_key: str = Field(description="Shown once. Store it on the device; only a hash is kept.")


# ---------- device-facing API (hardware contract) ----------

DeviceEventType = Literal[
    "medicine_due",
    "medicine_dispensed",
    "medicine_taken",
    "medicine_missed",
    "device_online",
    "device_offline",
    "device_error",
]


class HeartbeatIn(BaseModel):
    device_id: str | None = None
    timestamp: datetime | None = None
    firmware_version: Annotated[str, Field(pattern=r"^[0-9A-Za-z.+-]{1,32}$")] | None = None
    # SIM800L AT+CSQ value: 0-31, 99 = unknown.
    signal_strength: Annotated[int, Field(ge=0, le=99)] | None = None
    status: Literal["ok", "error"] = "ok"
    error: Text(200) | None = None


class HeartbeatOut(BaseModel):
    device_id: str
    status: DeviceStatus
    server_time: datetime
    heartbeat_interval_seconds: int


class DeviceEventIn(BaseModel):
    event_id: Annotated[str, Field(pattern=r"^[A-Za-z0-9_.:-]{6,64}$")]
    device_id: str
    event_type: DeviceEventType
    # Never trusted: the patient is derived from the authenticated device.
    patient_id: int | str | None = None
    medicine_id: int | None = None
    schedule_id: int | None = None
    dose_id: int | None = None
    event_time: datetime | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("event_time")
    @classmethod
    def _aware(cls, v: datetime | None) -> datetime | None:
        if v is not None and v.tzinfo is None:
            v = v.replace(tzinfo=UTC)
        return v

    @field_validator("metadata")
    @classmethod
    def _small(cls, v: dict[str, Any]) -> dict[str, Any]:
        if len(v) > 20 or len(str(v)) > 2000:
            raise ValueError("metadata is too large")
        return v


class DeviceEventOut(BaseModel):
    id: int
    event_id: str
    event_type: str
    result: Literal["applied", "ignored", "unmatched"]
    duplicate: bool
    detail: str | None
    dose_id: int | None
    dose_status: str | None
    received_at: datetime


class DeviceScheduleItem(BaseModel):
    schedule_id: int
    medicine_id: int
    medicine_name: str
    dose_quantity: Decimal
    dose_unit: str
    time_of_day: str
    period: Period
    days_of_week: list[int]
    start_date: date
    end_date: date | None


class DeviceConfigOut(BaseModel):
    device_id: str
    patient_assigned: bool
    timezone: str
    server_time: datetime
    heartbeat_interval_seconds: int
    missed_dose_timeout_minutes: int
    schedules: list[DeviceScheduleItem]


# ---------- notifications ----------


class NotificationOut(BaseModel):
    id: int
    type: str
    severity: str
    title: str
    body: str
    url: str
    patient_id: int | None
    patient_name: str | None
    device_id: int | None
    dose_id: int | None
    read_at: datetime | None
    created_at: datetime
    push_sent: int
    push_error: str | None


class NotificationPage(Page[NotificationOut]):
    unread: int


_B64URL = r"^[A-Za-z0-9_-]+={0,2}$"


class PushKeys(BaseModel):
    p256dh: Annotated[str, Field(pattern=_B64URL, min_length=80, max_length=100)]
    auth: Annotated[str, Field(pattern=_B64URL, min_length=16, max_length=32)]


class PushSubscriptionIn(BaseModel):
    endpoint: Annotated[str, Field(pattern=r"^https://[^\s]+$", max_length=1024)]
    expirationTime: int | None = None  # noqa: N815 (matches PushSubscription.toJSON())
    keys: PushKeys

    @field_validator("endpoint")
    @classmethod
    def _known_push_service(cls, v: str) -> str:
        # The server POSTs to this URL, so only accept real browser push services (no SSRF).
        host = (urlsplit(v).hostname or "").lower()
        allowed = get_settings().push_endpoint_host_list
        if not any(host == h or host.endswith("." + h) for h in allowed):
            raise ValueError("Unsupported push service")
        return v


class PushSubscriptionDeleteIn(BaseModel):
    endpoint: Annotated[str, Field(max_length=1024)]


class PushRenewIn(BaseModel):
    old_endpoint: Annotated[str, Field(max_length=1024)]
    subscription: PushSubscriptionIn


class PushStatusOut(BaseModel):
    configured: bool
    vapid_public_key: str | None
    subscriptions: int


class PushTestOut(BaseModel):
    sent: int
    failed: int
    errors: list[str]


class PreferencesIO(ORM):
    medicine_due: bool = True
    medicine_dispensed: bool = True
    medicine_taken: bool = True
    medicine_missed: bool = True
    device_offline: bool = True
    device_online: bool = True
    device_error: bool = True


# ---------- analytics / dashboard ----------


class DailyAdherence(DayStats):
    date: date


class AdherenceOut(BaseModel):
    patient_id: int | None
    today: DayStats
    week: DayStats
    month: DayStats
    daily: list[DailyAdherence]
    note: str = (
        "Adherence = confirmed taken doses / scheduled doses so far x 100. "
        "It reflects device and caretaker confirmations only and is not a clinical assessment."
    )


class PatientOverview(BaseModel):
    id: int
    full_name: str
    timezone: str
    device: DeviceBrief | None
    today: DayStats
    next_dose: DoseOut | None
    alert: Literal["missed", "device_offline", "device_error", "due", "ok"]


class DashboardSummary(BaseModel):
    patients: int
    doses_today: int
    taken: int
    pending: int
    missed: int
    late: int
    devices_total: int
    devices_online: int
    devices_offline: int
    adherence_today: float | None


class DashboardOut(BaseModel):
    generated_at: datetime
    summary: DashboardSummary
    doses: list[DoseOut]
    patients: list[PatientOverview]
    activity: list[EventOut]
    alerts: list[NotificationOut]
    week: list[DailyAdherence]


# ---------- admin ----------


class SystemConfigIO(ORM):
    missed_dose_timeout_minutes: int = Field(ge=5, le=720)
    late_dose_after_minutes: int = Field(ge=1, le=720)
    device_warning_after_minutes: int = Field(ge=1, le=1440)
    device_offline_after_minutes: int = Field(ge=2, le=10080)

    @model_validator(mode="after")
    def _ordered(self) -> "SystemConfigIO":
        if self.device_offline_after_minutes <= self.device_warning_after_minutes:
            raise ValueError("Offline threshold must be greater than the warning threshold")
        return self


class AuditOut(BaseModel):
    id: int
    actor_email: str | None
    actor_device_id: int | None
    action: str
    entity_type: str
    entity_id: str | None
    details: dict[str, Any]
    ip: str | None
    created_at: datetime


class HealthOut(BaseModel):
    status: Literal["ok", "degraded"]
    database: bool
    scheduler_running: bool
    scheduler_last_tick_at: datetime | None
    push_configured: bool
    websocket_connections: int
    users: int
    patients: int
    devices: dict[str, int]
    push_subscriptions: int
    notifications_24h: int
    events_24h: int
