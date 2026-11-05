from datetime import UTC, datetime
from math import ceil

from sqlalchemy.orm import selectinload

from app.models import Order

ACTIVE_STATUSES = (
    "placed",
    "accepted",
    "preparing",
    "ready_for_pickup",
    "handed_to_rider",
)
LATE_STATUSES = ("placed", "accepted", "preparing")
KITCHEN_VISIBLE_STATUSES = ("placed", "accepted", "preparing", "ready_for_pickup")


def order_load_options():
    return (
        selectinload(Order.items),
        selectinload(Order.status_events),
        selectinload(Order.user),
    )


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _late_values(order: Order) -> tuple[bool, int]:
    is_late = order.status in LATE_STATUSES and _now_utc() > order.promised_at
    minutes_late = (
        max(1, ceil((_now_utc() - order.promised_at).total_seconds() / 60))
        if is_late
        else 0
    )
    return is_late, minutes_late


def customer_first_name(order: Order) -> str | None:
    user = order.__dict__.get("user")
    name = getattr(user, "name", None) if user is not None else None
    if not name or not name.strip():
        return None
    return name.strip().split()[0]


def serialize_order(order: Order) -> dict[str, object]:
    is_late, minutes_late = _late_values(order)
    gst_included = round(order.total_inr * 5 / 105)
    is_escalated = (
        order.escalated_at is not None and order.escalation_acknowledged_at is None
    )
    return {
        "public_id": order.public_id,
        "outlet_id": str(order.outlet_id),
        "status": order.status,
        "payment_method": order.payment_method,
        "payment_status": order.payment_status,
        "total_inr": order.total_inr,
        "gst_included_inr": gst_included,
        "placed_at": order.placed_at,
        "promised_at": order.promised_at,
        "is_late": is_late,
        "minutes_late": minutes_late,
        "delivery_address": order.delivery_address,
        "notes": order.notes,
        "cancellation_reason": order.cancellation_reason,
        "customer_first_name": customer_first_name(order),
        "manager_override_minutes": order.manager_override_minutes,
        "escalated_at": order.escalated_at,
        "escalation_acknowledged_at": order.escalation_acknowledged_at,
        "is_escalated": is_escalated,
        "price_note": "incl. 5% GST",
        "items": [
            {
                "name": item.name,
                "unit_price_inr": item.unit_price_inr,
                "quantity": item.quantity,
                "addons": item.addons,
            }
            for item in order.items
        ],
        "status_history": [
            {"status": event.status, "at": event.at}
            for event in sorted(order.status_events, key=lambda event: event.at)
        ],
    }
