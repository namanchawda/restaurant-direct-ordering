from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from app.services.unpaid_orders import is_expired_unpaid_order


NOW = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)


def _order(*, payment_status: str, age_minutes: int) -> SimpleNamespace:
    return SimpleNamespace(
        payment_status=payment_status,
        status="placed",
        placed_at=NOW - timedelta(minutes=age_minutes),
    )


def test_paid_orders_are_never_selected() -> None:
    assert not is_expired_unpaid_order(
        _order(payment_status="paid", age_minutes=16),
        now=NOW,
        timeout_minutes=15,
    )


def test_unpaid_selection_is_strictly_older_than_timeout() -> None:
    assert not is_expired_unpaid_order(
        _order(payment_status="pending", age_minutes=15),
        now=NOW,
        timeout_minutes=15,
    )
    assert is_expired_unpaid_order(
        _order(payment_status="failed", age_minutes=16),
        now=NOW,
        timeout_minutes=15,
    )
