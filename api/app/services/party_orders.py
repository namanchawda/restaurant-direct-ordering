"""Pure party-order rules shared by the API and database-free tests."""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
PARTY_STATUSES = {"requested", "confirmed", "rejected", "cancelled", "completed"}
PARTY_TRANSITIONS = {
    "requested": {"confirmed", "rejected", "cancelled"},
    "confirmed": {"completed", "cancelled"},
    "rejected": set(),
    "cancelled": set(),
    "completed": set(),
}


def party_event_at(event_date: date, event_time: time) -> datetime:
    """Interpret party slots in Hyderabad local time and return an aware UTC time."""
    local = datetime.combine(event_date, event_time, tzinfo=IST)
    return local.astimezone(UTC)


def party_notice_message(event_at: datetime, now: datetime, minimum_hours: int) -> str | None:
    earliest = now + timedelta(hours=minimum_hours)
    if event_at < earliest:
        local_earliest = earliest.astimezone(IST)
        return (
            f"Party orders need at least {minimum_hours} hours notice. "
            f"Earliest slot: {local_earliest.strftime('%Y-%m-%d %H:%M')}"
        )
    return None


def party_date_limit_message(event_at: datetime, now: datetime, maximum_days: int) -> str | None:
    if event_at > now + timedelta(days=maximum_days):
        return f"Party orders can be placed no more than {maximum_days} days ahead."
    return None


def guest_limit_message(guests: int, minimum: int, maximum: int) -> str | None:
    if guests < minimum or guests > maximum:
        return f"Party orders are for {minimum} to {maximum} guests."
    return None


def total_limit_message(total_inr: int, minimum: int) -> str | None:
    if total_inr < minimum:
        return f"Party orders have a minimum estimated total of Rs {minimum}."
    return None


def can_transition(current: str, target: str) -> bool:
    return target in PARTY_TRANSITIONS.get(current, set())


def advance_amount(estimated_total_inr: int, percent: int) -> int:
    return round(estimated_total_inr * percent / 100)

