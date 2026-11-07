"""Reward and coupon rules that need no database: points math, redemption caps, coupon pricing, delivery fee."""

from datetime import UTC, datetime, timedelta

import pytest

from app.models import Coupon
from app.services.rewards import (
    MAX_REDEEM_PERCENT,
    MIN_REDEEM_BALANCE,
    POINT_VALUE_INR,
    REDEEM_STEP,
    coupon_discount,
    coupon_eligibility_error,
    delivery_fee,
    earn_points,
    points_discount,
    validate_redemption,
)

NOW = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)


def _coupon(**overrides) -> Coupon:
    values = {
        "code": "TEST10",
        "type": "percent",
        "value": 10,
        "min_order_inr": 0,
        "max_discount_inr": None,
        "valid_from": None,
        "valid_to": None,
        "usage_limit_total": None,
        "usage_limit_per_user": None,
        "first_order_only": False,
        "active": True,
        "is_demo": True,
    }
    values.update(overrides)
    return Coupon(**values)


def test_points_earned_one_per_ten_rupees_of_payable_total() -> None:
    assert earn_points(1030) == 103
    assert earn_points(499) == 49
    assert earn_points(100) == 10
    assert earn_points(99) == 9
    assert earn_points(0) == 0
    assert earn_points(-50) == 0


def test_redemption_only_in_steps_of_100_points() -> None:
    assert REDEEM_STEP == 100
    valid, reason = validate_redemption(150, 1000, 5000)
    assert not valid
    assert "steps of 100" in reason
    assert validate_redemption(100, 1000, 5000)[0] is True
    assert validate_redemption(300, 1000, 5000)[0] is True
    assert validate_redemption(0, 0, 5000)[0] is True


def test_redemption_needs_a_minimum_balance_of_200_points() -> None:
    assert MIN_REDEEM_BALANCE == 200
    valid, reason = validate_redemption(100, 199, 5000)
    assert not valid
    assert "At least 200 points" in reason
    assert validate_redemption(100, 200, 5000)[0] is True


def test_redemption_requires_enough_balance() -> None:
    valid, reason = validate_redemption(400, 300, 5000)
    assert not valid
    assert reason == "You do not have enough points."


def test_redemption_covers_at_most_20_percent_of_the_order() -> None:
    assert MAX_REDEEM_PERCENT == 20
    valid, reason = validate_redemption(800, 4000, 500)
    assert not valid
    assert "at most 20%" in reason
    valid, _ = validate_redemption(100, 4000, 500)
    assert valid


def test_one_point_is_fifty_paise() -> None:
    assert POINT_VALUE_INR == 0.5
    assert points_discount(100) == 50
    assert points_discount(400) == 200
    assert points_discount(0) == 0
    assert points_discount(-10) == 0


def test_coupon_percent_discount_is_floored() -> None:
    coupon = _coupon(type="percent", value=10)
    assert coupon_discount(coupon, 1030) == 103
    assert coupon_discount(coupon, 499) == 49
    assert coupon_discount(coupon, 0) == 0


def test_coupon_flat_discount_is_absolute() -> None:
    coupon = _coupon(type="flat", value=100)
    assert coupon_discount(coupon, 1030) == 100
    assert coupon_discount(coupon, 60) == 60
    assert coupon_discount(coupon, 0) == 0


def test_coupon_max_discount_cap_applies() -> None:
    capped = _coupon(type="percent", value=15, max_discount_inr=500)
    assert coupon_discount(capped, 10000) == 500
    assert coupon_discount(capped, 1000) == 150
    uncapped = _coupon(type="percent", value=15)
    assert coupon_discount(uncapped, 10000) == 1500


def test_coupon_minimum_order_not_met() -> None:
    coupon = _coupon(type="percent", value=10, min_order_inr=299)
    error = coupon_eligibility_error(coupon, 298, now=NOW)
    assert error == "Add Rs 1 more to use this coupon."
    assert coupon_eligibility_error(coupon, 299, now=NOW) is None


def test_coupon_not_valid_yet() -> None:
    coupon = _coupon(valid_from=NOW + timedelta(minutes=10))
    error = coupon_eligibility_error(coupon, 1000, now=NOW)
    assert error == "This coupon is not valid yet."
    assert coupon_eligibility_error(coupon, 1000, now=NOW + timedelta(minutes=11)) is None


def test_coupon_expired() -> None:
    coupon = _coupon(valid_to=NOW - timedelta(minutes=1))
    error = coupon_eligibility_error(coupon, 1000, now=NOW)
    assert error == "This coupon has expired."
    assert coupon_eligibility_error(coupon, 1000, now=NOW - timedelta(hours=1)) is None


def test_coupon_inactive_or_missing() -> None:
    error = coupon_eligibility_error(_coupon(active=False), 1000, now=NOW)
    assert error == "Coupon is not active or does not exist."


def test_coupon_usage_limits() -> None:
    per_user = _coupon(usage_limit_per_user=1)
    error = coupon_eligibility_error(
        per_user, 1000, now=NOW, total_used=5, user_used=1
    )
    assert error == "This coupon has already been used on this account."
    total = _coupon(usage_limit_total=2)
    error = coupon_eligibility_error(
        total, 1000, now=NOW, total_used=2, user_used=0
    )
    assert error == "This coupon has reached its usage limit."
    assert coupon_eligibility_error(
        total, 1000, now=NOW, total_used=1, user_used=1
    ) is None


def test_coupon_first_order_only() -> None:
    coupon = _coupon(first_order_only=True)
    error = coupon_eligibility_error(coupon, 1000, now=NOW, prior_paid_orders=1)
    assert error == "This coupon is for the first order only."
    assert coupon_eligibility_error(coupon, 1000, now=NOW, prior_paid_orders=0) is None


def test_freeship_offsets_the_delivery_fee_exactly() -> None:
    freeship = _coupon(code="FREESHIP", type="flat", value=30, min_order_inr=249)
    subtotal = 400
    off = coupon_discount(freeship, subtotal)
    assert off == 30
    fee = delivery_fee(subtotal)
    assert fee == 30
    before_points = max(0, subtotal - off + fee)
    assert before_points == subtotal


def test_delivery_fee_is_30_rupees_free_above_499() -> None:
    assert delivery_fee(499) == 30
    assert delivery_fee(500) == 0
    assert delivery_fee(1030) == 0
    assert delivery_fee(0) == 30


@pytest.mark.parametrize(
    ("subtotal", "coupon", "points"),
    [(0, 50, 0), (50, 1000, 0), (400, 30, 100), (499, 0, 400), (1030, 100, 900)],
)
def test_checkout_totals_never_go_negative(subtotal: int, coupon: int, points: int) -> None:
    assert coupon_discount(_coupon(type="flat", value=coupon), subtotal) <= subtotal
    fee = delivery_fee(subtotal)
    before_points = max(0, subtotal - min(coupon, subtotal) + fee)
    points_off = min(max(0, int(points * POINT_VALUE_INR)), before_points)
    assert max(0, before_points - points_off) >= 0
