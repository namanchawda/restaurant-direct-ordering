from datetime import datetime, timedelta


def calculate_promised_at(
    placed_at: datetime,
    min_prep_minutes: int,
    active_order_count: int,
    ai_estimate_minutes: int | None = None,
    manager_override_minutes: int | None = None,
) -> datetime:
    """Return a promise time; replace the load estimate with the AI estimate later."""
    if manager_override_minutes is not None:
        minutes = manager_override_minutes
    else:
        load_estimate = min_prep_minutes + min(max(active_order_count, 0) * 2, 20)
        minutes = max(ai_estimate_minutes or load_estimate, min_prep_minutes)
    return placed_at + timedelta(minutes=minutes)
