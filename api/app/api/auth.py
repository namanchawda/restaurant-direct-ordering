from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta
import time as monotonic_time

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.core.config import get_settings
from app.models import User
from app.schemas import LoginRequest, OTPRequest, OTPVerify

router = APIRouter(prefix="/auth", tags=["auth"])
_otp_requests: dict[str, deque[float]] = defaultdict(deque)


def _token_for(user: User) -> str:
    settings = get_settings()
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": str(user.id),
            "role": user.role,
            "outlet_id": str(user.outlet_id) if user.outlet_id else None,
            "iat": now,
            "exp": now + timedelta(minutes=settings.jwt_expiry_minutes),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )


def _auth_response(user: User) -> dict[str, object]:
    return {
        "access_token": _token_for(user),
        "token_type": "bearer",
        "user": {
            "id": str(user.id),
            "name": user.name,
            "phone": user.phone,
            "role": user.role,
            "outlet_id": str(user.outlet_id) if user.outlet_id else None,
            "marketing_opt_in": user.marketing_opt_in,
        },
    }


@router.post("/otp/request")
async def request_otp(payload: OTPRequest) -> dict[str, str]:
    now = monotonic_time.monotonic()
    for phone, timestamps in tuple(_otp_requests.items()):
        while timestamps and now - timestamps[0] >= 600:
            timestamps.popleft()
        if not timestamps:
            _otp_requests.pop(phone, None)
    requests = _otp_requests[payload.phone]
    if len(requests) >= 5:
        raise HTTPException(status_code=429, detail="Too many OTP requests. Try again later.")
    requests.append(now)
    return {"message": "If this phone number can sign in, enter the requested one-time code."}


@router.post("/otp/verify")
async def verify_otp(
    payload: OTPVerify, session: AsyncSession = Depends(get_db)
) -> dict[str, object]:
    if payload.otp != get_settings().mock_otp:
        raise HTTPException(status_code=401, detail="Invalid one-time code.")
    user = await session.scalar(select(User).where(User.phone == payload.phone))
    if user is not None and user.role != "customer":
        raise HTTPException(status_code=409, detail="Phone number belongs to a non-customer account.")
    if user is None:
        user = User(
            name=payload.name or "Customer",
            phone=payload.phone,
            role="customer",
            marketing_opt_in=payload.marketing_opt_in is True,
        )
        session.add(user)
    else:
        if payload.name:
            user.name = payload.name
        if "marketing_opt_in" in payload.model_fields_set:
            user.marketing_opt_in = payload.marketing_opt_in
    await session.commit()
    await session.refresh(user)
    return _auth_response(user)


@router.post("/login")
async def login(
    payload: LoginRequest, session: AsyncSession = Depends(get_db)
) -> dict[str, object]:
    user = await session.scalar(select(User).where(User.phone == payload.phone))
    if (
        user is None
        or user.role not in {"kitchen", "admin"}
        or user.password_hash is None
        or not bcrypt.checkpw(payload.password.encode(), user.password_hash.encode())
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect phone number or password.")
    return _auth_response(user)


@router.get("/me")
async def me(user: User = Depends(get_current_user)) -> dict[str, object]:
    return {
        "id": str(user.id),
        "name": user.name,
        "phone": user.phone,
        "role": user.role,
        "outlet_id": str(user.outlet_id) if user.outlet_id else None,
        "marketing_opt_in": user.marketing_opt_in,
    }
