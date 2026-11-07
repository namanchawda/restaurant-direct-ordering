from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Order, OrderStatusEvent
from app.services.events import publish_order_event
from app.services.order_payload import order_load_options
from app.services.rewards import settle_order_rewards

UNPAID_CANCELLATION_REASON = "Payment not completed in time"


def is_expired_unpaid_order(
    order: Order,
    *,
    now: datetime,
    timeout_minutes: int,
) -> bool:
    cutoff = now - timedelta(minutes=timeout_minutes)
    return (
        order.payment_status != "paid"
        and order.status == "placed"
        and order.placed_at < cutoff
    )


async def cancel_unpaid_order(
    session: AsyncSession,
    order: Order,
    *,
    reason: str,
) -> Order:
    if order.payment_status == "paid":
        raise ValueError("Paid orders must never be cancelled by the unpaid-order task.")

    order.status = "cancelled"
    order.cancellation_reason = reason
    if order.coupon_redemption is not None:
        await session.delete(order.coupon_redemption)
    await settle_order_rewards(session, order)
    order.status_events.append(OrderStatusEvent(status="cancelled", at=datetime.now(UTC)))
    await session.commit()

    cancelled = await session.scalar(
        select(Order)
        .options(*order_load_options())
        .where(Order.id == order.id)
    )
    if cancelled is None:
        raise RuntimeError("Cancelled order could not be reloaded.")
    await publish_order_event(
        cancelled,
        event_type="order.updated",
        message="Order cancelled",
    )
    return cancelled


async def cancel_expired_unpaid_orders(
    session: AsyncSession,
    *,
    now: datetime | None = None,
    timeout_minutes: int | None = None,
) -> list[Order]:
    settings = get_settings()
    current_time = now or datetime.now(UTC)
    timeout = (
        settings.unpaid_order_timeout_minutes
        if timeout_minutes is None
        else timeout_minutes
    )
    cutoff = current_time - timedelta(minutes=timeout)
    orders = (
        await session.scalars(
            select(Order)
            .options(*order_load_options())
            .where(
                Order.payment_status != "paid",
                Order.status == "placed",
                Order.placed_at < cutoff,
            )
            .order_by(Order.placed_at.asc())
        )
    ).all()

    cancelled: list[Order] = []
    for order in orders:
        if not is_expired_unpaid_order(
            order,
            now=current_time,
            timeout_minutes=timeout,
        ):
            continue
        cancelled.append(
            await cancel_unpaid_order(
                session,
                order,
                reason=UNPAID_CANCELLATION_REASON,
            )
        )
    return cancelled
