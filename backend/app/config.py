from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_ENV = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT_ENV, extra="ignore")

    environment: str = "development"
    database_url: str
    test_database_url: str | None = None

    jwt_secret: str = Field(min_length=32)
    jwt_access_token_expire_minutes: int = 30
    jwt_refresh_token_expire_days: int = 7

    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:admin@example.com"

    cors_origins: str = "http://localhost:5173"
    # Hosts (and their subdomains) that browsers use for Web Push: Chrome/Edge(FCM), Firefox, Edge(WNS), Safari.
    push_endpoint_hosts: str = "fcm.googleapis.com,push.services.mozilla.com,notify.windows.com,push.apple.com"
    device_api_secret: str = Field(min_length=32)

    # Defaults copied into system_config on first start; admins edit them in the app.
    missed_dose_timeout_minutes: int = 60
    late_dose_after_minutes: int = 30
    device_warning_after_minutes: int = 5
    device_offline_after_minutes: int = 15
    scheduler_interval_seconds: int = 30
    scheduler_enabled: bool = True
    default_timezone: str = "Asia/Kolkata"

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def push_endpoint_host_list(self) -> list[str]:
        return [h.strip().lower() for h in self.push_endpoint_hosts.split(",") if h.strip()]

    @property
    def push_configured(self) -> bool:
        return bool(self.vapid_public_key and self.vapid_private_key and self.vapid_subject)


@lru_cache
def get_settings() -> Settings:
    return Settings()
