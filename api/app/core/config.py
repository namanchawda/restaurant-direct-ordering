from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from sqlalchemy.engine import URL, make_url


class Settings(BaseSettings):
    database_url: str | None = None
    database_url_direct: str | None = None
    cors_origins: list[str] = ["http://localhost:3000"]
    jwt_secret: str = "replace-this-development-secret-before-deployment"
    jwt_expiry_minutes: int = Field(default=60, gt=0)
    mock_otp: str = "123456"

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )


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
