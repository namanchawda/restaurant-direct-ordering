"""Customer data erasure used by the admin CLI and the privacy notice.

Deleting a customer removes their orders (order items and status events are
removed by the database cascade) and their marketing consent.
"""

from __future__ import annotations

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Order, User


async def delete_customer_data(session: AsyncSession, phone: str) -> dict[str, object]:
    """Delete the customer with the given phone and all of their orders.

    Only plain customers are affected; kitchen and admin accounts are refused.
    Returns counts so the caller can report what was erased.
    """
    users = (
        await session.scalars(select(User).where(User.phone == phone))
    ).all()
    customers = [user for user in users if user.role == "customer"]
    non_customers = [user for user in users if user.role != "customer"]
    if not customers:
        return {
            "phone": phone,
            "deleted_users": 0,
            "deleted_orders": 0,
            "non_customers_found": len(non_customers),
        }

    user_ids = [user.id for user in customers]
    orders_count = int(
        await session.scalar(
            select(func.count()).select_from(Order).where(Order.user_id.in_(user_ids))
        )
        or 0
    )
    await session.execute(delete(Order).where(Order.user_id.in_(user_ids)))
    await session.execute(delete(User).where(User.id.in_(user_ids)))
    await session.commit()
    return {
        "phone": phone,
        "deleted_users": len(customers),
        "deleted_orders": orders_count,
        "non_customers_found": len(non_customers),
    }
