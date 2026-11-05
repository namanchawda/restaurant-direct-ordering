import asyncio
from collections import defaultdict
from typing import Any
from uuid import UUID

from app.models import Order

_subscribers: dict[str, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(set)


def subscribe_order_events(channel: str) -> asyncio.Queue[dict[str, Any]]:
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=100)
    _subscribers[channel].add(queue)
    return queue


def unsubscribe_order_events(channel: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
    _subscribers[channel].discard(queue)
    if not _subscribers[channel]:
        _subscribers.pop(channel, None)


async def publish_order_event(order: Order) -> None:
    payload = {
        "public_id": order.public_id,
        "outlet_id": str(order.outlet_id),
        "status": order.status,
        "payment_status": order.payment_status,
        "promised_at": order.promised_at.isoformat(),
    }
    channels = [f"order:{order.public_id}"]
    if order.payment_status == "paid":
        channels.append(f"outlet:{order.outlet_id}")
    for channel in channels:
        for queue in tuple(_subscribers[channel]):
            try:
                queue.put_nowait(payload)
            except asyncio.QueueFull:
                await queue.get()
                queue.put_nowait(payload)


def outlet_channel(outlet_id: UUID) -> str:
    return f"outlet:{outlet_id}"
