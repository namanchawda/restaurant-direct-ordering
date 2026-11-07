import logging
from datetime import datetime, timedelta
from math import ceil
from statistics import median

logger = logging.getLogger(__name__)
CAP_MINUTES = 90


def estimate_prep_minutes(
    item_weights: list[int], active_item_count: int, kitchen_capacity: int,
    historical_durations: list[int] | None = None,
) -> tuple[int, dict[str, object]]:
    """Transparent estimate: parallel base, queue load, then optional median correction."""
    weights = [max(0, int(value)) for value in item_weights] or [0]
    base = max(weights) + max(0, len(weights) - 1) * 2
    queue = (max(0, active_item_count) / max(1, kitchen_capacity)) * 10
    correction = 0.0
    history_used = False
    if historical_durations and len(historical_durations) >= 20:
        correction = float(median(historical_durations))
        history_used = True
    raw = (base + queue) * 0.7 + correction * 0.3 if history_used else base + queue
    minutes = min(CAP_MINUTES, int(ceil(max(0, raw) / 5) * 5))
    return minutes, {"base": round(base, 2), "queue": round(queue, 2), "correction": round(correction, 2), "history_used": history_used, "inputs": {"item_count": len(weights), "active_item_count": active_item_count, "kitchen_capacity": kitchen_capacity}}


def fallback_prep_minutes(min_prep_minutes: int, active_order_count: int) -> tuple[int, dict[str, object]]:
    minutes = max(0, int(min_prep_minutes)) + max(0, int(active_order_count)) * 2
    return minutes, {
        "base": float(min_prep_minutes),
        "queue": float(max(0, int(active_order_count)) * 2),
        "correction": 0.0,
        "history_used": False,
        "fallback": True,
        "inputs": {"active_order_count": max(0, int(active_order_count))},
    }


def estimate_breakdown_text(minutes: int, breakdown: dict[str, object] | None) -> str | None:
    if not breakdown:
        return None
    base = round(float(breakdown.get("base", 0)))
    queue = round(float(breakdown.get("queue", 0)))
    correction = round(float(breakdown.get("correction", 0)))
    parts = [base, queue, correction]
    labels = ["prep", "queue", "history"]
    # Rounding can make the parts drift from the total estimate. Adjust the
    # largest part so the shown parts still add up to the total estimate.
    difference = minutes - sum(parts)
    if difference:
        largest_index = max(range(3), key=lambda index: (parts[index], -index))
        parts[largest_index] += difference
    return (
        f"Estimate {minutes} min: "
        + " + ".join(f"{part} {label}" for part, label in zip(parts, labels))
    )


def calculate_promised_at(
    placed_at: datetime,
    min_prep_minutes: int,
    active_order_count: int,
    ai_estimate_minutes: int | None = None,
    manager_override_minutes: int | None = None,
) -> datetime:
    """Apply the single promise rule used by checkout, escalation, and overrides."""
    if manager_override_minutes is not None:
        # A manager's explicit promise is authoritative, including its exact value.
        return placed_at + timedelta(minutes=manager_override_minutes)
    load_estimate = min_prep_minutes + max(0, active_order_count) * 2
    minutes = max(ai_estimate_minutes or load_estimate, min_prep_minutes)
    # Only model output is capped and rounded; overrides returned above are untouched.
    return placed_at + timedelta(minutes=min(CAP_MINUTES, int(ceil(minutes / 5) * 5)))
