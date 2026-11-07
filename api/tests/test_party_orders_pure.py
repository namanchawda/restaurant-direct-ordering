"""Database-free party-order rule tests."""

from datetime import UTC, date, datetime, time, timedelta

import pytest

from app.services.party_orders import (
    PARTY_TRANSITIONS,
    advance_amount,
    can_transition,
    guest_limit_message,
    party_date_limit_message,
    party_event_at,
    party_notice_message,
    total_limit_message,
)

NOW = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)


def test_notice_boundary_and_readable_message() -> None:
    exactly = party_event_at(date(2026, 11, 8), time(17, 30))
    # Exactly 24 hours notice is inclusive (allowed): "at least 24 hours".
    now = exactly - timedelta(hours=24)
    assert party_notice_message(exactly, now, 24) is None
    # 23h59m notice is under the minimum and must be rejected.
    too_soon = exactly - timedelta(hours=23, minutes=59)
    message = party_notice_message(exactly, too_soon, 24)
    assert message is not None
    assert "Party orders need at least 24 hours notice." in message
    assert "Earliest slot:" in message


@pytest.mark.parametrize("guests", [9, 501])
def test_guest_limits(guests: int) -> None:
    assert guest_limit_message(guests, 10, 500) == "Party orders are for 10 to 500 guests."
    assert guest_limit_message(10, 10, 500) is None
    assert guest_limit_message(500, 10, 500) is None


def test_ninety_day_limit_is_inclusive() -> None:
    assert party_date_limit_message(NOW + timedelta(days=90), NOW, 90) is None
    assert party_date_limit_message(NOW + timedelta(days=90, minutes=1), NOW, 90) is not None


def test_minimum_estimated_total() -> None:
    assert total_limit_message(2999, 3000) == "Party orders have a minimum estimated total of Rs 3000."
    assert total_limit_message(3000, 3000) is None
    assert advance_amount(3000, 25) == 750


def test_party_transition_table() -> None:
    assert PARTY_TRANSITIONS["requested"] == {"confirmed", "rejected", "cancelled"}
    assert PARTY_TRANSITIONS["confirmed"] == {"completed", "cancelled"}
    assert can_transition("requested", "confirmed")
    assert can_transition("confirmed", "completed")
    assert not can_transition("rejected", "confirmed")
    assert not can_transition("completed", "cancelled")
