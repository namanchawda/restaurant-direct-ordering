import asyncio

import pytest

from app.services import events


@pytest.fixture(autouse=True)
def reset_broker():
    events.reset_for_tests()
    yield
    events.reset_for_tests()


@pytest.mark.asyncio
async def test_event_ids_are_monotonic_and_ring_replays_in_order() -> None:
    events.publish(
        "outlet:test",
        "order.created",
        {"type": "order.created", "order": {"public_id": "WEB-1"}},
    )
    events.publish(
        "outlet:test",
        "order.updated",
        {"type": "order.updated", "order": {"public_id": "WEB-1"}},
    )

    subscription = events.subscribe("outlet:test")
    stream = events.event_stream(subscription, heartbeat_seconds=1)
    assert (await anext(stream)).startswith("retry:")
    first = await anext(stream)
    second = await anext(stream)
    assert "id: 1" in first
    assert "event: order.created" in first
    assert "id: 2" in second
    assert "event: order.updated" in second
    await stream.aclose()
    assert events.stream_stats()["subscribers"] == 0


@pytest.mark.asyncio
async def test_heartbeat_when_no_events_arrive() -> None:
    subscription = events.subscribe("outlet:idle")
    stream = events.event_stream(subscription, heartbeat_seconds=0.05)
    assert (await anext(stream)).startswith("retry:")
    assert await asyncio.wait_for(anext(stream), timeout=1) == ": keep-alive\n\n"
    await stream.aclose()


@pytest.mark.asyncio
async def test_gap_in_history_requests_a_resync() -> None:
    for _ in range(events.RING_SIZE + 1):
        events.publish(
            "outlet:gap",
            "order.updated",
            {"type": "order.updated", "order": {"public_id": "WEB-1"}},
        )
    subscription = events.subscribe("outlet:gap")
    stream = events.event_stream(
        subscription, last_event_id="0", heartbeat_seconds=1
    )
    assert (await anext(stream)).startswith("retry:")
    resync = await anext(stream)
    assert resync.startswith("event: resync")
    assert "history-unavailable" in resync
    await stream.aclose()


@pytest.mark.asyncio
async def test_slow_subscriber_is_resynced_instead_of_blocking_publish() -> None:
    subscription = events.subscribe("outlet:slow")
    for _ in range(events.SUBSCRIBER_QUEUE_SIZE + 1):
        events.publish(
            "outlet:slow",
            "order.updated",
            {"type": "order.updated", "order": {"public_id": "WEB-1"}},
        )
    assert subscription.dropped_events > 0
    latest = events.latest_event_id("outlet:slow")
    stream = events.event_stream(
        subscription, last_event_id=str(latest), heartbeat_seconds=1
    )
    assert (await anext(stream)).startswith("retry:")
    resync = await anext(stream)
    assert resync.startswith("event: resync")
    assert "subscriber-fell-behind" in resync
    await stream.aclose()
