from datetime import datetime
from zoneinfo import ZoneInfo

from app.models import Category

HYDERABAD = ZoneInfo("Asia/Kolkata")


def category_window_status(category: Category, now: datetime) -> tuple[bool, str | None]:
    if category.available_from is None and category.available_to is None:
        return True, None
    if category.available_from is None or category.available_to is None:
        return False, "Availability window is incomplete."
    current_time = now.astimezone(HYDERABAD).time().replace(tzinfo=None)
    if category.available_from <= category.available_to:
        available = category.available_from <= current_time <= category.available_to
    else:
        available = current_time >= category.available_from or current_time <= category.available_to
    window_text = (
        f"{category.available_from.strftime('%H:%M')}-"
        f"{category.available_to.strftime('%H:%M')} Asia/Kolkata"
    )
    return available, window_text
