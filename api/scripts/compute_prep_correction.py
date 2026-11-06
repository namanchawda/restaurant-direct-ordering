"""Report outlet prep-history medians without changing data."""
import asyncio
import sys
from pathlib import Path
from statistics import median

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.session import get_session_factory
from app.models import Order


async def main() -> None:
    async with get_session_factory()() as session:
        orders = (await session.scalars(select(Order).options(selectinload(Order.status_events), selectinload(Order.outlet)).where(Order.payment_status == "paid", Order.status.in_(("ready_for_pickup", "handed_to_rider", "delivered"))).order_by(Order.placed_at.desc()))).all()
        grouped: dict[object, list[int]] = {}
        names: dict[object, str] = {}
        for order in orders:
            start = next((event.at for event in order.status_events if event.status in {"accepted", "preparing"}), None)
            ready = next((event.at for event in order.status_events if event.status == "ready_for_pickup"), None)
            if start is not None and ready is not None and ready >= start:
                grouped.setdefault(order.outlet_id, []).append(round((ready - start).total_seconds() / 60))
            names[order.outlet_id] = order.outlet.name if order.outlet else str(order.outlet_id)
        for outlet_id, durations in grouped.items():
            if len(durations) < 20:
                print(f"{names[outlet_id]}: {len(durations)} completed orders; correction not applied")
            else:
                print(f"{names[outlet_id]}: median correction {median(durations):g} minutes from {len(durations)} completed orders")


if __name__ == "__main__":
    asyncio.run(main())
