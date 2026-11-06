from datetime import UTC, datetime

from app.services.prep_time import calculate_promised_at, estimate_prep_minutes, fallback_prep_minutes


PLACED = datetime(2026, 1, 1, tzinfo=UTC)


def minutes_from_placed(value: datetime) -> int:
    return round((value - PLACED).total_seconds() / 60)


def test_manager_override_is_exact_and_beats_estimate():
    assert minutes_from_placed(calculate_promised_at(PLACED, 25, 0, 80, 42)) == 42
    assert minutes_from_placed(calculate_promised_at(PLACED, 25, 0, 90, 42)) == 42


def test_model_estimate_rounds_up_and_caps_at_90():
    assert minutes_from_placed(calculate_promised_at(PLACED, 1, 0, 42)) == 45
    assert minutes_from_placed(calculate_promised_at(PLACED, 1, 0, 240)) == 90


def test_estimate_rounds_up_to_five():
    estimate, _ = estimate_prep_minutes([20], active_item_count=1, kitchen_capacity=100)
    assert estimate == 25


def test_fallback_is_minimum_plus_two_per_active_order():
    estimate, breakdown = fallback_prep_minutes(25, 3)
    assert estimate == 31
    assert breakdown["fallback"] is True


def test_correction_requires_twenty_samples_and_load_is_monotonic():
    sparse, sparse_breakdown = estimate_prep_minutes([20], 0, 20, [40] * 19)
    corrected, corrected_breakdown = estimate_prep_minutes([20], 0, 20, [40] * 20)
    low_load, _ = estimate_prep_minutes([20], 1, 20)
    high_load, _ = estimate_prep_minutes([20], 20, 20)
    assert sparse_breakdown["history_used"] is False
    assert corrected_breakdown["history_used"] is True
    assert corrected >= sparse
    assert high_load >= low_load
    assert estimate_prep_minutes([20], 4, 20) == estimate_prep_minutes([20], 4, 20)
