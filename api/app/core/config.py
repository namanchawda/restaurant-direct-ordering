from functools import lru_cache

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL, make_url

INSECURE_JWT_SECRETS = {"replace-this-development-secret-before-deployment"}


class Settings(BaseSettings):
    environment: str = Field(
        default="development",
        validation_alias=AliasChoices("environment", "env"),
    )
    database_url: str | None = None
    database_url_direct: str | None = None
    cors_origins: list[str] = ["http://localhost:3000"]
    jwt_secret: str = "replace-this-development-secret-before-deployment"
    jwt_expiry_minutes: int = Field(default=60, gt=0)
    mock_otp: str = "123456"
    sse_heartbeat_seconds: int = Field(default=15, ge=5)
    sse_retry_ms: int = Field(default=3000, ge=500)
    escalation_minutes: int = Field(default=10, ge=1)
    escalation_extend_minutes: int = Field(default=10, ge=1)
    escalation_check_interval_seconds: int = Field(default=30, ge=5)
    kitchen_busy_queue_minutes: float = Field(default=10, gt=0)
    delivery_speed_kmh: float = Field(default=22, gt=0)
    delivery_sim_speed: float = Field(default=1, gt=0)

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    @model_validator(mode="after")
    def refuse_insecure_production_secret(self):
        if self.environment.lower() in {"production", "prod"} and self.jwt_secret in INSECURE_JWT_SECRETS:
            raise ValueError(
                "JWT_SECRET is still the insecure development default. Refusing to start with ENV=production."
            )
        return self


def to_asyncpg_url(value: str) -> URL:
    url = make_url(value)
    if url.drivername in {"postgres", "postgresql"}:
        url = url.set(drivername="postgresql+asyncpg")
    unsupported_asyncpg_options = {"sslmode", "channel_binding"}
    if unsupported_asyncpg_options.intersection(url.query):
        query = dict(url.query)
        for option in unsupported_asyncpg_options:
            query.pop(option, None)
        url = url.set(query=query)
    return url


@lru_cache
def get_settings() -> Settings:
    return Settings()
