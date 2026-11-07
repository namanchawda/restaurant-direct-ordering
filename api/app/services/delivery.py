"""Pure, deterministic delivery simulation helpers."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from math import atan2, cos, degrees, radians, sin, sqrt
from uuid import UUID

from app.core.config import get_settings

Point = tuple[float, float]


def haversine_km(start: Point, end: Point) -> float:
    lat1, lon1, lat2, lon2 = map(radians, (*start, *end))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 6371.0088 * 2 * atan2(sqrt(a), sqrt(1 - a))


def generate_route(outlet: Point, destination: Point, order_id: str | UUID, points: int | None = None) -> list[Point]:
    count = points or 8 + (sum(ord(char) for char in str(order_id)) % 7)
    seed = sum((index + 1) * ord(char) for index, char in enumerate(str(order_id)))
    lat1, lng1 = outlet
    lat2, lng2 = destination
    curve = ((seed % 11) - 5) / 18000
    route: list[Point] = []
    for index in range(count):
        t = index / (count - 1)
        bend = sin(t * 3.1415926535) * curve
        route.append((lat1 + (lat2 - lat1) * t + bend, lng1 + (lng2 - lng1) * t - bend * 0.7))
    route[0] = outlet
    route[-1] = destination
    return route


def route_distance_km(route: list[Point]) -> float:
    return sum(haversine_km(route[index - 1], route[index]) for index in range(1, len(route)))


def trip_duration(route: list[Point], speed_kmh: float | None = None, sim_speed: float | None = None) -> timedelta:
    settings = get_settings()
    speed = speed_kmh or settings.delivery_speed_kmh
    factor = sim_speed or settings.delivery_sim_speed
    return timedelta(hours=route_distance_km(route) / speed / factor)


def interpolate_route(route: list[Point], progress: float) -> tuple[Point, float]:
    if not route:
        raise ValueError("Route must contain at least one point")
    progress = max(0.0, min(1.0, progress))
    lengths = [0.0] + [haversine_km(route[index - 1], route[index]) for index in range(1, len(route))]
    total = sum(lengths)
    if total == 0:
        return route[0], 0.0
    target = total * progress
    travelled = 0.0
    for index in range(1, len(route)):
        segment = lengths[index]
        if travelled + segment >= target:
            local = (target - travelled) / segment if segment else 0.0
            lat = route[index - 1][0] + (route[index][0] - route[index - 1][0]) * local
            lng = route[index - 1][1] + (route[index][1] - route[index - 1][1]) * local
            heading = degrees(atan2(route[index][1] - route[index - 1][1], route[index][0] - route[index - 1][0]))
            return (lat, lng), heading
        travelled += segment
    last = route[-1]
    return last, 0.0


def delivery_progress(picked_up_at: datetime | None, now: datetime, duration: timedelta) -> float:
    if picked_up_at is None or duration.total_seconds() <= 0:
        return 0.0
    start = picked_up_at.astimezone(UTC)
    return max(0.0, min(1.0, (now.astimezone(UTC) - start).total_seconds() / duration.total_seconds()))


def derive_stage(*, status: str, rider_assigned_at: datetime | None, picked_up_at: datetime | None, delivered_at: datetime | None, progress: float = 0.0) -> str:
    if delivered_at is not None or status == "delivered": return "delivered"
    if picked_up_at is not None: return "arriving" if progress >= 0.82 else "on_the_way"
    if rider_assigned_at is not None: return "at_restaurant" if status in {"ready_for_pickup", "handed_to_rider"} else "rider_assigned"
    return "finding_rider"


def can_auto_deliver(*, picked_up_at: datetime | None, progress: float) -> bool:
    return picked_up_at is not None and progress >= 1.0
