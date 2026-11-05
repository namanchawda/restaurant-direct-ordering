from functools import lru_cache

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import get_settings, to_asyncpg_url


def create_database_engine() -> AsyncEngine:
    database_url = get_settings().database_url
    if not database_url:
        raise RuntimeError("DATABASE_URL must be set before using the database.")

    return create_async_engine(
        to_asyncpg_url(database_url),
        connect_args={"ssl": "require", "statement_cache_size": 0},
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
    )


@lru_cache
def get_session_factory() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(create_database_engine(), expire_on_commit=False)
