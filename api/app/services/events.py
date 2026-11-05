import asyncio
import itertools
import json
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from app.models import Order
from app.services.order_payload import serialize_order

RING_SIZE = 200
SUBSCRIBER_QUEUE_SIZE = 200

_event_ids = itertools.count(1)
_rings: dict[str, deque["Event"]] = defaultdict(lambda: deque(maxlen=RING_SIZE))
_subscribers: dict[str, set["Subscription"]] = defaultdict(set)


@dataclass(frozen=True)
class Event:
    id: int
    type: str
    payload: dict[str, Any]
    published_at: datetime
    channel: str


@dataclass(eq=False)
class Subscription:
    channel: str
    queue: asyncio.Queue[Event | None] = field(
        default_factory=lambda: asyncio.Queue(maxsize=SUBSCRIBER_QUEUE_SIZE)
    )
    dropped_events: int = 0


def outlet_channel(outlet_id: UUID | str) -> str:
    return f"outlet:{outlet_id}"


def order_channel(public_id: str) -> str:
    return f"order:{public_id}"


def subscribe(channel: str) -> Subscription:
    subscription = Subscription(channel=channel)
    _subscribers[channel].add(subscription)
    return subscription


def unsubscribe(subscription: Subscription) -> None:
    subscribers = _subscribers.get(subscription.channel)
    if subscribers is None:
        return
    subscribers.discard(subscription)
    if not subscribers:
        _subscribers.pop(subscription.channel, None)


def publish(channel: str, event_type: str, payload: dict[str, Any]) -> Event:
    event = Event(
        id=next(_event_ids),
        type=event_type,
        payload=payload,
        published_at=datetime.now(UTC),
        channel=channel,
    )
    _rings[channel].append(event)
    for subscription in tuple(_subscribers.get(channel, ())):
        try:
            subscription.queue.put_nowait(event)
        except asyncio.QueueFull:
            subscription.dropped_events += subscription.queue.qsize()
            while True:
                try:
                    subscription.queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
            subscription.queue.put_nowait(None)
    return event


async def publish_order_event(
    order: Order, event_type: str | None = None
) -> list[Event]:
    resolved_type = event_type or (
        "order.created" if order.payment_status == "paid" else "order.updated"
    )
    payload = {"type": resolved_type, "order": serialize_order(order)}
    channels = [order_channel(order.public_id)]
    if order.payment_status == "paid":
        channels.append(outlet_channel(order.outlet_id))
    return [publish(channel, resolved_type, payload) for channel in channels]


def latest_event_id(channel: str) -> int | None:
    ring = _rings.get(channel)
    return ring[-1].id if ring else None


def _replay(channel: str, last_event_id: str | None) -> list[Event] | None:
    ring = _rings.get(channel)
    if not ring:
        return []
    if last_event_id is None:
        return list(ring)
    try:
        last_id = int(last_event_id)
    except (TypeError, ValueError):
        return None
    oldest = ring[0].id
    latest = ring[-1].id
    if last_id > latest or last_id < oldest - 1:
        return None
    return [event for event in ring if event.id > last_id]


def _format_event(event: Event) -> str:
    data = json.dumps(event.payload, separators=(",", ":"), default=str)
    return f"id: {event.id}\nevent: {event.type}\ndata: {data}\n\n"


async def event_stream(
    subscription: Subscription,
    *,
    last_event_id: str | None = None,
    heartbeat_seconds: int = 15,
    retry_ms: int = 3000,
):
    try:
        yield f"retry: {retry_ms}\n\n"
        replayed = _replay(subscription.channel, last_event_id)
        if replayed is None:
            yield 'event: resync\ndata: {"reason":"history-unavailable"}\n\n'
        else:
            for event in replayed:
                yield _format_event(event)
        while True:
            try:
                event = await asyncio.wait_for(
                    subscription.queue.get(), timeout=heartbeat_seconds
                )
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
                continue
            if event is None:
                yield 'event: resync\ndata: {"reason":"subscriber-fell-behind"}\n\n'
                continue
            yield _format_event(event)
    finally:
        unsubscribe(subscription)


def stream_stats() -> dict[str, Any]:
    channels: list[dict[str, Any]] = []
    for channel, subscribers in sorted(_subscribers.items()):
        channels.append(
            {
                "channel": channel,
                "subscribers": len(subscribers),
                "dropped_events": sum(
                    subscription.dropped_events for subscription in subscribers
                ),
                "buffered_events": len(_rings.get(channel, ())),
            }
        )
    return {
        "subscribers": sum(channel["subscribers"] for channel in channels),
        "dropped_events": sum(channel["dropped_events"] for channel in channels),
        "channels": channels,
    }


def reset_for_tests() -> None:
    _rings.clear()
    _subscribers.clear()
    global _event_ids
    _event_ids = itertools.count(1)
