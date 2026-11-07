"""Database-free tests for customer address and favourite rules."""

from datetime import UTC, datetime
from uuid import uuid4

from app.services.customer_profile import (
    ADDRESS_LIMIT,
    address_limit_error,
    at_address_limit,
    default_switch_plan,
    promote_after_delete,
)

NOW = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)


def _address(address_id, is_default=False, created_at=None):
    return {
        "id": address_id,
        "is_default": is_default,
        "created_at": created_at or NOW,
    }


def test_address_limit_is_five() -> None:
    assert ADDRESS_LIMIT == 5
    assert address_limit_error() == "You can save up to 5 addresses."


def test_at_address_limit() -> None:
    assert not at_address_limit(0)
    assert not at_address_limit(4)
    assert at_address_limit(5)


def test_default_switch_plan_clears_old_default() -> None:
    a, b, c = uuid4(), uuid4(), uuid4()
    clear_ids, set_default = default_switch_plan(
        [_address(a, True, NOW), _address(b, False, NOW), _address(c, False, NOW)],
        b,
    )
    assert clear_ids == [a]
    assert set_default == b


def test_default_switch_plan_no_clear_when_unchanged() -> None:
    a, b = uuid4(), uuid4()
    clear_ids, set_default = default_switch_plan(
        [_address(a, True, NOW), _address(b, False, NOW)],
        a,
    )
    assert clear_ids == []
    assert set_default == a


def test_default_switch_plan_no_current_default() -> None:
    a, b = uuid4(), uuid4()
    clear_ids, set_default = default_switch_plan(
        [_address(a, False, NOW), _address(b, False, NOW)],
        b,
    )
    assert clear_ids == []
    assert set_default == b


def test_promote_after_delete_promotes_most_recent() -> None:
    a, b, c = uuid4(), uuid4(), uuid4()
    addresses = [
        _address(a, True, NOW),
        _address(b, False, NOW),
        _address(c, False, NOW.replace(minute=1)),
    ]
    # c is the most recent remaining after deleting the default a.
    assert promote_after_delete(addresses, a) == c


def test_promote_after_delete_no_remaining() -> None:
    a = uuid4()
    assert promote_after_delete([_address(a, True, NOW)], a) is None
