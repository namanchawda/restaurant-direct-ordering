r"""Preview or remove test-created users and orders from the configured database.

Run from ``api``:

    .\.venv\Scripts\python -m scripts.cleanup_test_data
    .\.venv\Scripts\python -m scripts.cleanup_test_data --apply
"""

from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.session import create_database_engine
from app.models import Order, OrderItem, OrderStatusEvent, User
from app.seed import DEMO_USERS, SAMPLE_ORDERS, seed_data

KEEP_USER_PHONES = {user["phone"] for user in DEMO_USERS}
KEEP_ORDER_PUBLIC_IDS = {order["public_id"] for order in SAMPLE_ORDERS}


@dataclass(frozen=True)
class CleanupPlan:
    users: list[User]
    orders: list[tuple[Order, str]]
    order_item_count: int
    status_event_count: int


async def build_cleanup_plan(session: AsyncSession) -> CleanupPlan:
    users = list(
        (
            await session.scalars(
                select(User)
                .where(User.phone.not_in(KEEP_USER_PHONES))
                .order_by(User.phone)
            )
        ).all()
    )
    orders = list(
        (
            await session.execute(
                select(Order, User.phone)
                .join(User, Order.user_id == User.id)
                .where(Order.public_id.not_in(KEEP_ORDER_PUBLIC_IDS))
                .order_by(Order.public_id)
            )
        ).all()
    )
    order_ids = [order.id for order, _ in orders]

    if order_ids:
        order_item_count = await session.scalar(
            select(func.count())
            .select_from(OrderItem)
            .where(OrderItem.order_id.in_(order_ids))
        )
        status_event_count = await session.scalar(
            select(func.count())
            .select_from(OrderStatusEvent)
            .where(OrderStatusEvent.order_id.in_(order_ids))
        )
    else:
        order_item_count = 0
        status_event_count = 0

    return CleanupPlan(
        users=users,
        orders=orders,
        order_item_count=order_item_count or 0,
        status_event_count=status_event_count or 0,
    )


def print_cleanup_plan(plan: CleanupPlan, *, apply: bool) -> None:
    print("Test data selected for cleanup:")
    print(f"Users ({len(plan.users)}):")
    if plan.users:
        for user in plan.users:
            load_test_label = (
                " (load test)"
                if user.role == "customer" and user.phone.startswith("8000")
                else ""
            )
            print(f"  - {user.phone} | {user.name} | {user.role}{load_test_label}")
    else:
        print("  - none")

    print(f"Orders ({len(plan.orders)}):")
    if plan.orders:
        for order, phone in plan.orders:
            print(f"  - {order.public_id} | customer {phone} | {order.status}")
    else:
        print("  - none")

    action = "Deleting" if apply else "Would delete"
    print(f"{action} counts:")
    print(f"  orders: {len(plan.orders)}")
    print(f"  order_items: {plan.order_item_count}")
    print(f"  order_status_events: {plan.status_event_count}")
    print(f"  users: {len(plan.users)}")


async def delete_test_data(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        async with session.begin():
            plan = await build_cleanup_plan(session)
            print_cleanup_plan(plan, apply=True)

            order_ids = [order.id for order, _ in plan.orders]
            user_ids = [user.id for user in plan.users]
            if order_ids:
                await session.execute(
                    delete(OrderStatusEvent).where(
                        OrderStatusEvent.order_id.in_(order_ids)
                    )
                )
                await session.execute(
                    delete(OrderItem).where(OrderItem.order_id.in_(order_ids))
                )
                await session.execute(delete(Order).where(Order.id.in_(order_ids)))
            if user_ids:
                await session.execute(delete(User).where(User.id.in_(user_ids)))

        await seed_data(session)


async def preview_test_data(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        plan = await build_cleanup_plan(session)
        print_cleanup_plan(plan, apply=False)
        print("Dry run only; no changes made. Use --apply to delete these records.")


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Delete the listed records and restore seeded data. Default: dry run.",
    )
    args = parser.parse_args()

    engine = create_database_engine()
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        if args.apply:
            await delete_test_data(session_factory)
        else:
            await preview_test_data(session_factory)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
