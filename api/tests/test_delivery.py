from datetime import UTC, datetime, timedelta

from app.services.delivery import (
    can_auto_deliver,
    delivery_progress,
    derive_stage,
    generate_route,
    interpolate_route,
    trip_duration,
)


def test_route_is_deterministic_and_has_endpoints():
    start, end = (17.46, 78.36), (17.48, 78.40)
    first = generate_route(start, end, "order-1")
    assert first == generate_route(start, end, "order-1")
    assert 8 <= len(first) <= 14
    assert first[0] == start and first[-1] == end


def test_position_interpolation_at_key_progress_points():
    route = generate_route((0.0, 0.0), (1.0, 1.0), "order-2")
    assert interpolate_route(route, 0)[0] == route[0]
    middle = interpolate_route(route, 0.5)[0]
    assert 0.2 < middle[0] < 0.8 and 0.2 < middle[1] < 0.8
    assert interpolate_route(route, 1)[0] == route[-1]


def test_stage_derivation_and_speed_factor():
    now = datetime.now(UTC)
    assert derive_stage(status="preparing", rider_assigned_at=None, picked_up_at=None, delivered_at=None) == "finding_rider"
    assert derive_stage(status="preparing", rider_assigned_at=now, picked_up_at=None, delivered_at=None) == "rider_assigned"
    route = generate_route((17.46, 78.36), (17.48, 78.40), "order-3")
    assert trip_duration(route, speed_kmh=22, sim_speed=6) < trip_duration(route, speed_kmh=22, sim_speed=1)


def test_trip_progress_never_delivers_before_pickup():
    now = datetime.now(UTC)
    assert delivery_progress(None, now, timedelta(minutes=1)) == 0
    assert not can_auto_deliver(picked_up_at=None, progress=1)
    assert can_auto_deliver(picked_up_at=now - timedelta(minutes=2), progress=1)
