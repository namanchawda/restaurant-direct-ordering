"""Opt-in demo history generator. Use --confirm; --remove deletes only 7000 users/orders."""
import argparse
import asyncio
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import delete, select

from app.db.session import get_session_factory
from app.models import Category, MenuItem, Order, OrderItem, OrderStatusEvent, Outlet, User

PHONE_PREFIX = "7000"


async def remove() -> None:
    async with get_session_factory()() as session:
        users = (await session.scalars(select(User).where(User.phone.like(f"{PHONE_PREFIX}%")))).all()
        await session.execute(delete(Order).where(Order.user_id.in_([user.id for user in users])))
        await session.execute(delete(User).where(User.phone.like(f"{PHONE_PREFIX}%")))
        await session.commit()
        print(f"Removed demo history for {len(users)} users.")


async def seed() -> None:
    async with get_session_factory()() as session:
        outlets = (await session.scalars(select(Outlet).order_by(Outlet.name))).all()[:3]
        items = (await session.scalars(select(MenuItem).order_by(MenuItem.sort_order))).all()
        if len(outlets) < 3 or not items:
            raise RuntimeError("Run the base seed first.")
        users = []
        for index in range(6):
            user = User(name=f"Demo history {index + 1}", phone=f"7000{index:06d}", role="customer", marketing_opt_in=False)
            users.append(user); session.add(user)
        await session.flush()
        now = datetime.now(UTC).replace(second=0, microsecond=0)
        order_number = 0
        for day in range(14):
            date = now - timedelta(days=day)
            peak = date.weekday() in {4, 6}
            count = 12 if peak else 5
            for index in range(count):
                outlet = outlets[index % len(outlets)]
                user = users[index % len(users)]
                placed = date.replace(hour=20 if peak else 13, minute=(index * 7) % 60)
                status = "cancelled" if index % 17 == 0 else "delivered"
                prep = 24 + (index % 5) * 3 + (10 if peak else 0)
                ready = placed + timedelta(minutes=prep)
                order_number += 1
                order = Order(public_id=f"DEMO-7000-{order_number:05d}", outlet_id=outlet.id, user_id=user.id, status=status, payment_method="upi", payment_status="paid", total_inr=450 + index * 20, delivery_address="Demo address, Hyderabad", placed_at=placed, promised_at=placed + timedelta(minutes=30), ai_estimate_minutes=30)
                item = items[index % len(items)]
                order.items.append(OrderItem(item_id=item.id, name=item.name, unit_price_inr=item.base_price_inr, quantity=1))
                order.status_events.extend([OrderStatusEvent(status="placed", at=placed), OrderStatusEvent(status="accepted", at=placed + timedelta(minutes=2)), OrderStatusEvent(status="preparing", at=placed + timedelta(minutes=4))])
                if status == "cancelled":
                    order.cancellation_reason = "Customer changed plans"
                    order.status_events.append(OrderStatusEvent(status="cancelled", at=placed + timedelta(minutes=8)))
                else:
                    order.status_events.extend([OrderStatusEvent(status="ready_for_pickup", at=ready), OrderStatusEvent(status="handed_to_rider", at=ready + timedelta(minutes=3)), OrderStatusEvent(status="delivered", at=ready + timedelta(minutes=25))])
                session.add(order)
        await session.commit()
        print(f"Created {order_number} demo orders for {len(users)} users.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm", action="store_true", help="explicitly opt in to creating demo data")
    parser.add_argument("--remove", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    if args.remove:
        asyncio.run(remove())
    elif args.confirm:
        asyncio.run(seed())
    else:
        raise SystemExit("Refusing to create demo history without --confirm.")
