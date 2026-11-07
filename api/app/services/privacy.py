"""Customer data erasure used by the admin CLI and the privacy notice.

Deleting a customer removes their orders (order items and status events are
removed by the database cascade) and their marketing consent.
"""

from __future__ import annotations

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    CustomerAddress,
    CustomerFavorite,
    LoyaltyAccount,
    LoyaltyTransaction,
    Order,
    User,
)


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


async def anonymise_customer(session: AsyncSession, user: User) -> dict[str, object]:
    """Anonymise a customer's personal data in place for a DPDP erasure request.

    The user row is kept (name and phone are anonymised, marketing consent and
    password are cleared) so that their orders remain for accounting with the
    user detached. Saved addresses, favourites and loyalty rows are deleted.

    Returns counts of what was erased. Orders are kept untouched.
    """
    if user.role != "customer":
        return {
            "phone": user.phone,
            "anonymised": False,
            "error": "Only customer accounts can be anonymised.",
        }

    anonymised_phone = f"del-{str(user.id)[:12]}"
    user.name = "Deleted Customer"
    user.phone = anonymised_phone
    user.marketing_opt_in = False
    user.password_hash = None
    session.add(user)

    address_count = int(
        await session.scalar(
            select(func.count()).select_from(CustomerAddress).where(
                CustomerAddress.user_id == user.id
            )
        )
        or 0
    )
    favourite_count = int(
        await session.scalar(
            select(func.count()).select_from(CustomerFavorite).where(
                CustomerFavorite.user_id == user.id
            )
        )
        or 0
    )
    loyalty_tx_count = int(
        await session.scalar(
            select(func.count()).select_from(LoyaltyTransaction).where(
                LoyaltyTransaction.user_id == user.id
            )
        )
        or 0
    )
    await session.execute(
        delete(CustomerAddress).where(CustomerAddress.user_id == user.id)
    )
    await session.execute(
        delete(CustomerFavorite).where(CustomerFavorite.user_id == user.id)
    )
    await session.execute(
        delete(LoyaltyTransaction).where(LoyaltyTransaction.user_id == user.id)
    )
    await session.execute(delete(LoyaltyAccount).where(LoyaltyAccount.user_id == user.id))

    orders_count = int(
        await session.scalar(
            select(func.count()).select_from(Order).where(Order.user_id == user.id)
        )
        or 0
    )
    await session.commit()
    return {
        "phone": user.phone,
        "anonymised": True,
        "deleted_addresses": address_count,
        "deleted_favourites": favourite_count,
        "deleted_loyalty_transactions": loyalty_tx_count,
        "deleted_loyalty_accounts": 1,
        "orders_kept": orders_count,
    }

