"""Shared test helpers."""
from sqlalchemy import delete, select

from app.db.session import get_session_factory
from app.models import CouponRedemption, LoyaltyAccount, LoyaltyTransaction, Order, PartyOrder, PartyStatusEvent, User


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
        party_ids = list((await session.scalars(select(PartyOrder.id).where(PartyOrder.user_id == user.id))).all())
        if party_ids:
            await session.execute(delete(PartyStatusEvent).where(PartyStatusEvent.party_order_id.in_(party_ids)))
            await session.execute(delete(PartyOrder).where(PartyOrder.id.in_(party_ids)))
        await session.execute(delete(Order).where(Order.user_id == user.id))
        await session.delete(user)
        await session.commit()
