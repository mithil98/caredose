"""SQLAlchemy models. Timestamps are stored in UTC (timestamptz)."""

from datetime import date, datetime, time
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    ARRAY,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

ROLES = ("admin", "caretaker")
PERIODS = ("morning", "afternoon", "evening", "night")
DOSE_STATUSES = ("scheduled", "due", "dispensed", "taken", "missed", "cancelled")
EVENT_TYPES = (
    "medicine_due",
    "medicine_dispensed",
    "medicine_taken",
    "medicine_missed",
    "medicine_cancelled",
    "device_online",
    "device_offline",
    "device_error",
)
NOTIFICATION_TYPES = (
    "medicine_due",
    "medicine_dispensed",
    "medicine_taken",
    "medicine_missed",
    "device_offline",
    "device_online",
    "device_error",
    "test",
)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class User(TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint(_in("role", ROLES), name="role_valid"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    full_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), default="caretaker")
    timezone: Mapped[str] = mapped_column(String(64))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Patient(TimestampMixin, Base):
    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(primary_key=True)
    caretaker_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    contact_phone: Mapped[str | None] = mapped_column(String(32))
    notes: Mapped[str | None] = mapped_column(String(500))
    timezone: Mapped[str] = mapped_column(String(64))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    caretaker: Mapped[User] = relationship(lazy="joined")
    devices: Mapped[list["Device"]] = relationship(back_populates="patient")


class Device(TimestampMixin, Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(primary_key=True)
    device_uid: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str | None] = mapped_column(String(80))
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    patient_id: Mapped[int | None] = mapped_column(ForeignKey("patients.id", ondelete="SET NULL"), index=True)
    key_hash: Mapped[str] = mapped_column(String(64))
    firmware_version: Mapped[str | None] = mapped_column(String(32))
    signal_strength: Mapped[int | None] = mapped_column(SmallInteger)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set by explicit device_offline / device_error events, cleared by the next heartbeat.
    reported_state: Mapped[str | None] = mapped_column(String(16))
    last_error: Mapped[str | None] = mapped_column(String(200))
    # Start of the current offline episode (set once alerted). Doubles as the alert dedupe key.
    offline_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    patient: Mapped[Patient | None] = relationship(back_populates="devices")


class Medicine(TimestampMixin, Base):
    __tablename__ = "medicines"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    generic_name: Mapped[str | None] = mapped_column(String(120))
    dose_quantity: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    dose_unit: Mapped[str] = mapped_column(String(24))
    instructions: Mapped[str | None] = mapped_column(String(500))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class MedicineSchedule(TimestampMixin, Base):
    __tablename__ = "medicine_schedules"
    __table_args__ = (
        CheckConstraint(_in("period", PERIODS), name="period_valid"),
        CheckConstraint("end_date IS NULL OR end_date >= start_date", name="dates_ordered"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"), index=True)
    medicine_id: Mapped[int] = mapped_column(ForeignKey("medicines.id", ondelete="CASCADE"), index=True)
    dose_quantity: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    time_of_day: Mapped[time] = mapped_column(Time)
    period: Mapped[str] = mapped_column(String(16))
    # ISO weekday numbers 1 (Monday) .. 7 (Sunday)
    days_of_week: Mapped[list[int]] = mapped_column(ARRAY(SmallInteger))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    medicine: Mapped[Medicine] = relationship(lazy="joined")


class MedicineDose(TimestampMixin, Base):
    """One concrete occurrence of a schedule on a given day. Owns the dose state machine."""

    __tablename__ = "medicine_doses"
    __table_args__ = (
        CheckConstraint(_in("status", DOSE_STATUSES), name="status_valid"),
        UniqueConstraint("schedule_id", "scheduled_for", name="uq_dose_schedule_time"),
        Index("ix_dose_patient_time", "patient_id", "scheduled_for"),
        Index("ix_dose_status_time", "status", "scheduled_for"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    schedule_id: Mapped[int | None] = mapped_column(ForeignKey("medicine_schedules.id", ondelete="SET NULL"))
    medicine_id: Mapped[int | None] = mapped_column(ForeignKey("medicines.id", ondelete="SET NULL"))
    device_id: Mapped[int | None] = mapped_column(ForeignKey("devices.id", ondelete="SET NULL"))
    # Snapshot so history survives medicine/schedule edits and deletes.
    medicine_name: Mapped[str] = mapped_column(String(120))
    dose_quantity: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    dose_unit: Mapped[str] = mapped_column(String(24))
    period: Mapped[str] = mapped_column(String(16))
    scheduled_for: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    local_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(16), default="scheduled")
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dispensed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    taken_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    missed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_late: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    patient: Mapped[Patient] = relationship(lazy="joined")


class MedicineEvent(Base):
    """Append-only log of everything that happened (device, server scheduler, caretaker)."""

    __tablename__ = "medicine_events"
    __table_args__ = (
        CheckConstraint(_in("event_type", EVENT_TYPES), name="event_type_valid"),
        Index("ix_event_patient_time", "patient_id", "event_time"),
        Index("ix_event_received", "received_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # "<device_uid>:<event_id>" for device events, "server:..." for engine events.
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True)
    event_id: Mapped[str] = mapped_column(String(64))
    source: Mapped[str] = mapped_column(String(16))
    event_type: Mapped[str] = mapped_column(String(32))
    result: Mapped[str] = mapped_column(String(16))
    detail: Mapped[str | None] = mapped_column(String(200))
    device_id: Mapped[int | None] = mapped_column(ForeignKey("devices.id", ondelete="SET NULL"))
    patient_id: Mapped[int | None] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    dose_id: Mapped[int | None] = mapped_column(ForeignKey("medicine_doses.id", ondelete="SET NULL"))
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    event_time: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    meta: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, default=dict)

    device: Mapped[Device | None] = relationship(lazy="joined")
    dose: Mapped[MedicineDose | None] = relationship(lazy="joined")


class PushSubscription(TimestampMixin, Base):
    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    endpoint: Mapped[str] = mapped_column(Text, unique=True)
    p256dh: Mapped[str] = mapped_column(String(128))
    auth: Mapped[str] = mapped_column(String(64))
    expiration_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(String(255))
    failure_count: Mapped[int] = mapped_column(Integer, default=0)


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    medicine_due: Mapped[bool] = mapped_column(Boolean, default=True)
    medicine_dispensed: Mapped[bool] = mapped_column(Boolean, default=True)
    medicine_taken: Mapped[bool] = mapped_column(Boolean, default=True)
    medicine_missed: Mapped[bool] = mapped_column(Boolean, default=True)
    device_offline: Mapped[bool] = mapped_column(Boolean, default=True)
    device_online: Mapped[bool] = mapped_column(Boolean, default=True)
    device_error: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Notification(TimestampMixin, Base):
    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint(_in("type", NOTIFICATION_TYPES), name="type_valid"),
        UniqueConstraint("user_id", "dedupe_key", name="uq_notification_dedupe"),
        Index("ix_notification_user_time", "user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(32))
    severity: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(String(500))
    url: Mapped[str] = mapped_column(String(255))
    dedupe_key: Mapped[str] = mapped_column(String(128))
    patient_id: Mapped[int | None] = mapped_column(ForeignKey("patients.id", ondelete="SET NULL"))
    device_id: Mapped[int | None] = mapped_column(ForeignKey("devices.id", ondelete="SET NULL"))
    dose_id: Mapped[int | None] = mapped_column(ForeignKey("medicine_doses.id", ondelete="SET NULL"))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    push_sent: Mapped[int] = mapped_column(Integer, default=0)
    push_error: Mapped[str | None] = mapped_column(String(255))

    patient: Mapped[Patient | None] = relationship(lazy="joined")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    actor_device_id: Mapped[int | None] = mapped_column(ForeignKey("devices.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(64))
    entity_type: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[str | None] = mapped_column(String(64))
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    actor: Mapped[User | None] = relationship(lazy="joined")


class SystemConfig(Base):
    """Single-row table (id = 1) holding admin-editable engine thresholds."""

    __tablename__ = "system_config"
    __table_args__ = (CheckConstraint("id = 1", name="single_row"),)

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    missed_dose_timeout_minutes: Mapped[int] = mapped_column(Integer)
    late_dose_after_minutes: Mapped[int] = mapped_column(Integer)
    device_warning_after_minutes: Mapped[int] = mapped_column(Integer)
    device_offline_after_minutes: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
