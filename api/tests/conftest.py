"""Shared test helpers."""
from sqlalchemy import delete, select

from app.db.session import get_session_factory
from app.models import CouponRedemption, LoyaltyAccount, LoyaltyTransaction, Order, User


async def delete_customer_data(phone: str) -> None:
    """Delete customer children first: their user FKs are NOT NULL, and
    session.delete(user) would otherwise emit UPDATE ... SET user_id = NULL."""
    async with get_session_factory()() as session:
        user = await session.scalar(select(User).where(User.phone == phone))
        if user is None:
            return
        await session.execute(
            delete(LoyaltyTransaction).where(LoyaltyTransaction.user_id == user.id)
        )
        await session.execute(
            delete(CouponRedemption).where(CouponRedemption.user_id == user.id)
        )
        await session.execute(
            delete(LoyaltyAccount).where(LoyaltyAccount.user_id == user.id)
        )
        await session.execute(delete(Order).where(Order.user_id == user.id))
        await session.delete(user)
        await session.commit()
