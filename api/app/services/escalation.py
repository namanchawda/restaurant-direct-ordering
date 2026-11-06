import asyncio
import logging
from datetime import UTC, datetime, timedelta
from math import ceil

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.models import Order
from app.services.events import publish_order_event
from app.services.order_payload import LATE_STATUSES, order_load_options
from app.services.prep_time import calculate_promised_at

logger = logging.getLogger(__name__)


async def run_escalation_once(
    session: AsyncSession,
    *,
    now: datetime | None = None,
    escalation_minutes: int | None = None,
    extend_minutes: int | None = None,
) -> list[Order]:
    settings = get_settings()
    current_time = now or datetime.now(UTC)
    threshold_minutes = (
        settings.escalation_minutes
        if escalation_minutes is None
        else escalation_minutes
    )
    extension = (
        settings.escalation_extend_minutes
        if extend_minutes is None
        else extend_minutes
    )
    cutoff = current_time - timedelta(minutes=threshold_minutes)
    orders = (
        await session.scalars(
            select(Order)
            .options(*order_load_options())
            .where(
                Order.payment_status == "paid",
                Order.status.in_(LATE_STATUSES),
                Order.escalated_at.is_(None),
                Order.promised_at < cutoff,
            )
            .order_by(Order.promised_at.asc())
        )
    ).all()
    if not orders:
        return []

    escalated: list[Order] = []
    for order in orders:
        minutes_late = max(
            1,
            ceil((current_time - order.promised_at).total_seconds() / 60),
        )
        order.escalated_at = current_time
        order.escalation_acknowledged_at = None
        order.promised_at = calculate_promised_at(
            current_time,
            min_prep_minutes=0,
            active_order_count=0,
            manager_override_minutes=extension,
        )
        escalated.append(order)
        logger.warning(
            "Escalating order %s at outlet %s: %s minutes past promise. "
            "Manager alert mocked (WhatsApp/SMS); customer estimate extended by %s minutes.",
            order.public_id,
            order.outlet_id,
            minutes_late,
            extension,
        )
    await session.commit()

    for order in escalated:
        await publish_order_event(order, event_type="order.escalated")
    return escalated


async def escalation_loop() -> None:
    settings = get_settings()
    interval = settings.escalation_check_interval_seconds
    await asyncio.sleep(interval)
    while True:
        try:
            async with get_session_factory()() as session:
                await run_escalation_once(session)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Escalation check failed; retrying next interval.")
        await asyncio.sleep(interval)
