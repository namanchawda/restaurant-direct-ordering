from collections.abc import AsyncIterator, Callable
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.models import User

bearer = HTTPBearer(auto_error=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with get_session_factory()() as session:
        yield session


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")
    try:
        claims = jwt.decode(
            credentials.credentials,
            get_settings().jwt_secret,
            algorithms=["HS256"],
        )
        user_id = UUID(claims["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired access token.") from None
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User no longer exists.")
    if claims.get("role") != user.role or claims.get("outlet_id") != (
        str(user.outlet_id) if user.outlet_id else None
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Access token is no longer valid.")
    return user

async def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: AsyncSession = Depends(get_db),
) -> User | None:
    if credentials is None:
        return None
    try:
        claims = jwt.decode(credentials.credentials, get_settings().jwt_secret, algorithms=["HS256"])
        user_id = UUID(claims["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError):
        return None
    return await session.get(User, user_id)


def require_role(role: str) -> Callable:
    async def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role != role:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"{role.title()} role required.")
        return user

    return dependency


def require_roles(*roles: str) -> Callable:
    async def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            labels = "/".join(role.title() for role in roles)
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"{labels} role required.")
        return user

    return dependency
