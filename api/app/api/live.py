from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_role
from app.core.config import get_settings
from app.models import Order, User
from app.services import events
from app.services.stream_tokens import (
    KITCHEN_STREAM_SCOPE,
    ORDER_STREAM_SCOPE,
    STREAM_TOKEN_TTL_SECONDS,
    StreamTokenError,
    create_stream_token,
    decode_stream_token,
)

router = APIRouter(tags=["live"])

STREAM_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


@router.post("/kitchen/stream-token")
async def kitchen_stream_token(
    user: User = Depends(require_role("kitchen")),
) -> dict[str, object]:
    if user.outlet_id is None:
        raise HTTPException(status_code=409, detail="Kitchen user is not assigned to an outlet.")
    token = create_stream_token(
        user_id=user.id,
        role=user.role,
        outlet_id=user.outlet_id,
        scope=KITCHEN_STREAM_SCOPE,
    )
    return {
        "token": token,
        "expires_in": STREAM_TOKEN_TTL_SECONDS,
        "channel": events.outlet_channel(user.outlet_id),
    }


@router.post("/orders/{public_id}/stream-token")
async def order_stream_token(
    public_id: str,
    user: User = Depends(require_role("customer")),
    session: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    order = await session.scalar(
        select(Order).where(
            Order.public_id == public_id,
            Order.user_id == user.id,
        )
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found.")
    token = create_stream_token(
        user_id=user.id,
        role=user.role,
        outlet_id=None,
        scope=ORDER_STREAM_SCOPE,
        order_public_id=order.public_id,
    )
    return {
        "token": token,
        "expires_in": STREAM_TOKEN_TTL_SECONDS,
        "channel": events.order_channel(order.public_id),
    }


@router.get("/kitchen/stream/stats")
async def kitchen_stream_stats(
    _: User = Depends(require_role("kitchen")),
) -> dict[str, object]:
    return events.stream_stats()


@router.get("/kitchen/stream")
async def kitchen_stream(
    request: Request,
    token: str = Query(min_length=1),
    last_event_id: str | None = Query(default=None),
) -> StreamingResponse:
    try:
        claims = decode_stream_token(token, expected_scope=KITCHEN_STREAM_SCOPE)
    except StreamTokenError as error:
        raise HTTPException(status_code=401, detail=str(error)) from None
    if claims.get("role") != "kitchen" or not claims.get("outlet_id"):
        raise HTTPException(status_code=403, detail="Kitchen stream access required.")
    subscription = events.subscribe(events.outlet_channel(str(claims["outlet_id"])))
    settings = get_settings()
    return StreamingResponse(
        events.event_stream(
            subscription,
            last_event_id=request.headers.get("last-event-id") or last_event_id,
            heartbeat_seconds=settings.sse_heartbeat_seconds,
            retry_ms=settings.sse_retry_ms,
        ),
        media_type="text/event-stream",
        headers=STREAM_HEADERS,
    )


@router.get("/orders/{public_id}/stream")
async def order_stream(
    public_id: str,
    request: Request,
    token: str = Query(min_length=1),
    last_event_id: str | None = Query(default=None),
) -> StreamingResponse:
    try:
        claims = decode_stream_token(token, expected_scope=ORDER_STREAM_SCOPE)
    except StreamTokenError as error:
        raise HTTPException(status_code=401, detail=str(error)) from None
    if claims.get("role") != "customer" or claims.get("order_public_id") != public_id:
        raise HTTPException(status_code=403, detail="Order stream access required.")
    subscription = events.subscribe(events.order_channel(public_id))
    settings = get_settings()
    return StreamingResponse(
        events.event_stream(
            subscription,
            last_event_id=request.headers.get("last-event-id") or last_event_id,
            heartbeat_seconds=settings.sse_heartbeat_seconds,
            retry_ms=settings.sse_retry_ms,
        ),
        media_type="text/event-stream",
        headers=STREAM_HEADERS,
    )
