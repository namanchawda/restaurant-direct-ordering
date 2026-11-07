from datetime import UTC, datetime
from math import ceil

from sqlalchemy.orm import selectinload

from app.models import Order
from app.core.config import get_settings
from app.services.prep_time import estimate_breakdown_text

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
        selectinload(Order.rider),
        selectinload(Order.outlet),
        selectinload(Order.coupon_redemption),
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
    # Step 12 stored the pricing breakdown, but orders created before it (and
    # unsaved in-memory orders) have None there. Fall back to the total as the
    # subtotal and to zero for every missing discount/fee.
    subtotal = order.total_inr if order.items_subtotal_inr is None else order.items_subtotal_inr
    coupon_off = 0 if order.coupon_discount_inr is None else order.coupon_discount_inr
    points_off = 0 if order.points_discount_inr is None else order.points_discount_inr
    delivery_off = 0 if order.delivery_fee_inr is None else order.delivery_fee_inr
    redeemed_points = 0 if order.redeemed_points is None else order.redeemed_points
    return {
        "public_id": order.public_id,
        "outlet_id": str(order.outlet_id),
        "status": order.status,
        "payment_method": order.payment_method,
        "payment_status": order.payment_status,
        "total_inr": order.total_inr,
        "items_subtotal_inr": subtotal,
        "coupon_discount_inr": coupon_off,
        "points_discount_inr": points_off,
        "delivery_fee_inr": delivery_off,
        "coupon_code": order.coupon_code,
        "redeemed_points": redeemed_points,
        "earn_points": max(0, (subtotal - coupon_off) // 10),
        "gst_included_inr": gst_included,
        "placed_at": order.placed_at,
        "promised_at": order.promised_at,
        "is_late": is_late,
        "minutes_late": minutes_late,
        "delivery_address": order.delivery_address,
        "delivery_lat": order.delivery_lat,
        "delivery_lng": order.delivery_lng,
        "notes": order.notes,
        "cancellation_reason": order.cancellation_reason,
        "customer_first_name": customer_first_name(order),
        "manager_override_minutes": order.manager_override_minutes,
        "ai_estimate_minutes": order.ai_estimate_minutes,
        "estimate_breakdown": order.estimate_breakdown,
        "estimate_breakdown_text": estimate_breakdown_text(order.ai_estimate_minutes or 0, order.estimate_breakdown),
        "kitchen_busy": bool(
            order.estimate_breakdown
            and float(order.estimate_breakdown.get("queue", 0)) > get_settings().kitchen_busy_queue_minutes
        ),
        "escalated_at": order.escalated_at,
        "escalation_acknowledged_at": order.escalation_acknowledged_at,
        "rider_id": str(order.rider_id) if order.rider_id else None,
        "rider_assigned_at": order.rider_assigned_at,
        "picked_up_at": order.picked_up_at,
        "delivered_at": order.delivered_at,
        "delivery_eta_at": order.delivery_eta_at,
        "is_escalated": is_escalated,
        "price_note": "incl. 5% GST",
        "delivery_fee_note": "Delivery fee shown separately; item prices incl. 5% GST.",
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
