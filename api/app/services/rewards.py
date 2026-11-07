from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Coupon, CouponRedemption, LoyaltyAccount, LoyaltyTransaction, Order

EARN_POINTS_PER_INR = 10
POINT_VALUE_INR = 0.5
REDEEM_STEP = 100
MIN_REDEEM_BALANCE = 200
MAX_REDEEM_PERCENT = 20

def earn_points(payable_items_inr: int) -> int:
    return max(0, payable_items_inr // EARN_POINTS_PER_INR)

def points_discount(points: int) -> int:
    return max(0, int(points * POINT_VALUE_INR))

def validate_redemption(points: int, balance: int, order_total_inr: int) -> tuple[bool, str | None]:
    if points == 0: return True, None
    if balance < MIN_REDEEM_BALANCE: return False, f"At least {MIN_REDEEM_BALANCE} points are needed to redeem."
    if points % REDEEM_STEP: return False, f"Points can be redeemed in steps of {REDEEM_STEP}."
    if points > balance: return False, "You do not have enough points."
    if points_discount(points) > order_total_inr * MAX_REDEEM_PERCENT // 100: return False, "Points can cover at most 20% of this order."
    return True, None

def coupon_discount(coupon: Coupon, subtotal_inr: int, *, now: datetime | None = None) -> int:
    if coupon.type == "percent": discount = subtotal_inr * coupon.value // 100
    else: discount = coupon.value
    if coupon.max_discount_inr is not None: discount = min(discount, coupon.max_discount_inr)
    return max(0, min(discount, subtotal_inr))

def coupon_eligibility_error(
    coupon: Coupon,
    subtotal_inr: int,
    *,
    now: datetime,
    total_used: int = 0,
    user_used: int = 0,
    prior_paid_orders: int = 0,
) -> str | None:
    if not coupon.active: return "Coupon is not active or does not exist."
    if coupon.valid_from is not None and now < coupon.valid_from: return "This coupon is not valid yet."
    if coupon.valid_to is not None and now > coupon.valid_to: return "This coupon has expired."
    if subtotal_inr < coupon.min_order_inr: return f"Add Rs {coupon.min_order_inr - subtotal_inr} more to use this coupon."
    if coupon.usage_limit_total is not None and total_used >= coupon.usage_limit_total: return "This coupon has reached its usage limit."
    if coupon.usage_limit_per_user is not None and user_used >= coupon.usage_limit_per_user: return "This coupon has already been used on this account."
    if coupon.first_order_only and prior_paid_orders: return "This coupon is for the first order only."
    return None

def delivery_fee(subtotal_inr: int) -> int:
    return 0 if subtotal_inr > 499 else 30

def tier_for(lifetime_points: int) -> str:
    return "Gold" if lifetime_points >= 1500 else "Silver" if lifetime_points >= 500 else "Bronze"

async def get_or_create_account(session: AsyncSession, user_id, *, lock: bool = False) -> LoyaltyAccount:
    stmt = select(LoyaltyAccount).where(LoyaltyAccount.user_id == user_id)
    if lock: stmt = stmt.with_for_update()
    account = await session.scalar(stmt)
    if account is None:
        account = LoyaltyAccount(user_id=user_id, balance_points=0, lifetime_points=0); session.add(account); await session.flush()
    return account

async def settle_order_rewards(session: AsyncSession, order: Order) -> None:
    account = await get_or_create_account(session, order.user_id, lock=True)
    existing = (await session.scalars(select(LoyaltyTransaction).where(LoyaltyTransaction.order_id == order.id))).all()
    if order.status == "delivered" and order.payment_status == "paid" and not any(t.type == "earn" for t in existing):
        points = earn_points(max(0, order.items_subtotal_inr - order.coupon_discount_inr))
        if points:
            account.balance_points += points; account.lifetime_points += points
            session.add(LoyaltyTransaction(user_id=order.user_id, order_id=order.id, type="earn", points=points, balance_after=account.balance_points, note="Direct order delivered"))
    if order.status == "cancelled" and order.redeemed_points and not any(t.type == "reverse" for t in existing):
        account.balance_points += order.redeemed_points
        session.add(LoyaltyTransaction(user_id=order.user_id, order_id=order.id, type="reverse", points=order.redeemed_points, balance_after=account.balance_points, note="Cancelled order redemption reversed"))
