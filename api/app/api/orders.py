from datetime import UTC, datetime
import logging
import re
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_role, get_optional_user
from app.api.admin import _set_availability
from app.models import (
    Category,
    ItemAddon,
    MenuItem,
    Order,
    OrderItem,
    OrderStatusEvent,
    Outlet,
    OutletItemAvailability,
    Rider,
    User,
    Coupon,
    CouponRedemption,
    LoyaltyTransaction,
    LoyaltyAccount,
)
from app.schemas import (
    AvailabilityUpdate,
    CancelRequest,
    OrderCreate,
    OrderQuote,
    CouponEligible,
    CouponValidate,
    OverrideUpdate,
    PaymentRequest,
    StatusUpdate,
)
from app.services.events import publish_order_event
from app.services.geo import distance_km
from app.services.menu import category_window_status
from app.services.order_payload import (
    ACTIVE_STATUSES,
    KITCHEN_VISIBLE_STATUSES,
    order_load_options,
    serialize_order,
)
from app.services.prep_time import calculate_promised_at, estimate_prep_minutes, fallback_prep_minutes
from app.services.delivery import derive_stage, delivery_progress, generate_route, interpolate_route, route_distance_km, trip_duration
from app.services.rewards import coupon_discount, coupon_eligibility_error, delivery_fee, earn_points, get_or_create_account, points_discount, settle_order_rewards, validate_redemption
from app.services.unpaid_orders import cancel_unpaid_order

router = APIRouter(tags=["orders"])
logger = logging.getLogger(__name__)


@router.get("/orders/suggestions")
async def order_suggestions(
    outlet_id: UUID,
    user: User = Depends(require_role("customer")),
    session: AsyncSession = Depends(get_db),
) -> list[dict[str, object]]:
    outlet = await session.get(Outlet, outlet_id)
    if outlet is None:
        raise HTTPException(status_code=404, detail="Outlet not found.")
    rows = (
        await session.execute(
            select(MenuItem, func.count(OrderItem.id).label("frequency"), func.max(Order.placed_at).label("last_ordered"))
            .options(selectinload(MenuItem.category), selectinload(MenuItem.city_prices))
            .join(OrderItem, OrderItem.item_id == MenuItem.id)
            .join(Order, Order.id == OrderItem.order_id)
            .join(Category, Category.id == MenuItem.category_id)
            .join(
                OutletItemAvailability,
                (OutletItemAvailability.item_id == MenuItem.id)
                & (OutletItemAvailability.outlet_id == outlet_id)
                & OutletItemAvailability.available.is_(True),
            )
            .where(Order.user_id == user.id, Order.payment_status == "paid", MenuItem.active.is_(True))
            .group_by(MenuItem.id, Category.id)
            .order_by(func.count(OrderItem.id).desc(), func.max(Order.placed_at).desc())
            .limit(12)
        )
    ).all()
    now = _now_utc()
    suggestions: list[dict[str, object]] = []
    for item, _, _ in rows:
        in_window, _ = category_window_status(item.category, now)
        if not in_window:
            continue
        price = next((row.price_inr for row in item.city_prices if row.city.casefold() == outlet.city.casefold()), item.base_price_inr)
        suggestions.append({"item_id": str(item.id), "name": item.name, "photo_url": item.photo_url, "price_inr": price, "is_veg": item.is_veg})
        if len(suggestions) == 3:
            break
    return suggestions
kitchen_router = APIRouter(prefix="/kitchen", tags=["kitchen"])
TRANSITIONS = {
    "placed": {"accepted", "cancelled"},
    "accepted": {"preparing", "cancelled"},
    "preparing": {"ready_for_pickup", "cancelled"},
    "ready_for_pickup": {"handed_to_rider"},
    "handed_to_rider": {"delivered"},
}

@kitchen_router.get("/stats")
async def kitchen_stats(
    outlet_id: UUID | None = None,
    from_date: datetime | None = Query(None, alias="from"),
    to_date: datetime | None = Query(None, alias="to"),
    user: User = Depends(require_role("kitchen")), session: AsyncSession = Depends(get_db)
) -> dict[str, object]:
    if user.outlet_id is None:
        raise HTTPException(status_code=403, detail="Kitchen users must be assigned to an outlet.")
    if outlet_id is not None and outlet_id != user.outlet_id:
        raise HTTPException(status_code=403, detail="Kitchen users can only view their own outlet.")
    from app.api.admin import dashboard_data
    return await dashboard_data(
        user=user,
        session=session,
        outlet_id=user.outlet_id,
        from_date=from_date,
        to_date=to_date,
    )


def _now_utc() -> datetime:
    return datetime.now(UTC)


async def _get_order(session: AsyncSession, public_id: str) -> Order:
    order = await session.scalar(
        select(Order).options(*order_load_options()).where(Order.public_id == public_id)
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found.")
    return order


async def _new_public_id(session: AsyncSession) -> str:
    import secrets

    for _ in range(10):
        candidate = f"WEB-{secrets.randbelow(1_000_000):06d}"
        exists = await session.scalar(select(Order.id).where(Order.public_id == candidate))
        if exists is None:
            return candidate
    raise HTTPException(status_code=503, detail="Could not allocate an order number. Please retry.")

async def _calculate_cart(session: AsyncSession, outlet: Outlet, lines) -> tuple[list[OrderItem], int, list[int]]:
    items: list[OrderItem] = []
    weights: list[int] = []
    subtotal = 0
    current_time = _now_utc()
    for line in lines:
        item = await session.scalar(select(MenuItem).options(selectinload(MenuItem.variants), selectinload(MenuItem.addon_links).selectinload(ItemAddon.addon), selectinload(MenuItem.outlet_availability), selectinload(MenuItem.category), selectinload(MenuItem.city_prices)).where(MenuItem.id == line.item_id))
        if item is None or not item.active: raise HTTPException(status_code=409, detail="One or more menu items are unavailable.")
        if not any(row.outlet_id == outlet.id and row.available for row in item.outlet_availability): raise HTTPException(status_code=409, detail=f"{item.name} is not available at this outlet right now.")
        in_window, _ = category_window_status(item.category, current_time)
        if not in_window: raise HTTPException(status_code=409, detail=f"{item.name} is not available at this outlet right now.")
        weights.extend([item.category.prep_weight_minutes] * line.quantity)
        base = next((price.price_inr for price in item.city_prices if price.city.casefold() == outlet.city.casefold()), item.base_price_inr)
        unit = base; name = item.name
        if line.variant_id:
            variant = next((value for value in item.variants if value.id == line.variant_id), None)
            if variant is None: raise HTTPException(status_code=422, detail="The selected variant does not belong to this item.")
            unit = variant.price_inr; name = f"{item.name} - {variant.name}"
        if len(set(line.addon_ids)) != len(line.addon_ids): raise HTTPException(status_code=422, detail="Addon IDs must be unique for each item.")
        allowed = {link.addon_id: link.addon for link in item.addon_links}
        if any(addon_id not in allowed for addon_id in line.addon_ids): raise HTTPException(status_code=422, detail="One or more addons are not available for this item.")
        addons = [{"id": str(addon_id), "name": allowed[addon_id].name, "price_inr": allowed[addon_id].price_inr} for addon_id in line.addon_ids]
        subtotal += (unit + sum(addon["price_inr"] for addon in addons)) * line.quantity
        items.append(OrderItem(item_id=item.id, variant_id=line.variant_id, name=name, unit_price_inr=unit, quantity=line.quantity, addons=addons))
    return items, subtotal, weights

async def _coupon_for(session: AsyncSession, code: str | None, user: User | None, subtotal: int, *, outlet_id: UUID | None = None) -> tuple[Coupon | None, int, str | None]:
    if not code: return None, 0, None
    coupon = await session.scalar(select(Coupon).where(Coupon.code == code.strip().upper()))
    if coupon is None: return None, 0, "Coupon is not active or does not exist."
    now = _now_utc()
    total_used = await session.scalar(select(func.count(CouponRedemption.id)).where(CouponRedemption.coupon_id == coupon.id)) if coupon.usage_limit_total is not None else 0
    user_used = 0
    prior = 0
    if user is not None:
        if coupon.usage_limit_per_user is not None:
            user_used = await session.scalar(select(func.count(CouponRedemption.id)).where(CouponRedemption.coupon_id == coupon.id, CouponRedemption.user_id == user.id)) or 0
        if coupon.first_order_only:
            prior = await session.scalar(select(func.count(Order.id)).where(Order.user_id == user.id, Order.payment_status == "paid")) or 0
    reason = coupon_eligibility_error(coupon, subtotal, now=now, total_used=int(total_used or 0), user_used=int(user_used), prior_paid_orders=int(prior))
    if reason is not None: return None, 0, reason
    return coupon, coupon_discount(coupon, subtotal), None


def compute_totals(subtotal: int, coupon_off: int, redeem_points: int) -> tuple[int, int, int, int]:
    """Shared pricing math for /orders/quote and POST /orders: returns (fee, before_points, points_off, total)."""
    fee = delivery_fee(subtotal)
    before_points = max(0, subtotal - coupon_off + fee)
    points_off = min(points_discount(redeem_points), before_points)
    total = max(0, before_points - points_off)
    return fee, before_points, points_off, total


@router.post("/orders", status_code=201)
async def create_order(
    payload: OrderCreate,
    user: User = Depends(require_role("customer")),
    session: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    if payload.phone != user.phone:
        raise HTTPException(status_code=422, detail="Phone confirmation must match your account.")
    outlet = await session.get(Outlet, payload.outlet_id)
    if outlet is None:
        raise HTTPException(status_code=404, detail="Outlet not found.")
    if not outlet.is_open:
        raise HTTPException(status_code=409, detail="This outlet is closed.")
    distance = distance_km(
        payload.delivery_address.lat,
        payload.delivery_address.lng,
        outlet.lat,
        outlet.lng,
    )
    if distance > outlet.delivery_radius_km:
        raise HTTPException(status_code=422, detail="Delivery address is outside this outlet's delivery radius.")

    items, subtotal, item_weights = await _calculate_cart(session, outlet, payload.items)
    coupon, coupon_off, coupon_reason = await _coupon_for(session, payload.coupon_code, user, subtotal)
    if payload.coupon_code and coupon is None:
        raise HTTPException(status_code=422, detail=coupon_reason or "Coupon cannot be applied.")
    fee, before_points, points_off, total = compute_totals(subtotal, coupon_off, payload.redeem_points)
    valid_points, point_reason = validate_redemption(payload.redeem_points, (await get_or_create_account(session, user.id, lock=True)).balance_points, before_points)
    if not valid_points: raise HTTPException(status_code=422, detail=point_reason or "Points cannot be redeemed.")

    active_count = await session.scalar(
        select(func.count(Order.id)).where(
            Order.outlet_id == outlet.id,
            Order.status.in_(ACTIVE_STATUSES),
            Order.payment_status == "paid",
        )
    )
    active_items = await session.scalar(
        select(func.coalesce(func.sum(OrderItem.quantity), 0)).join(Order).where(
            Order.outlet_id == outlet.id, Order.status.in_(ACTIVE_STATUSES), Order.payment_status == "paid"
        )
    )
    history_orders = (
        await session.scalars(
            select(Order)
            .options(selectinload(Order.status_events))
            .where(
                Order.outlet_id == outlet.id,
                Order.payment_status == "paid",
                Order.status.in_(("ready_for_pickup", "handed_to_rider", "delivered")),
            )
            .order_by(Order.placed_at.desc())
            .limit(50)
        )
    ).all()
    historical_durations: list[int] = []
    for history_order in history_orders:
        start = next((event.at for event in history_order.status_events if event.status in {"accepted", "preparing"}), None)
        ready = next((event.at for event in history_order.status_events if event.status == "ready_for_pickup"), None)
        if start is not None and ready is not None and ready >= start:
            historical_durations.append(max(0, round((ready - start).total_seconds() / 60)))
    try:
        estimate, breakdown = estimate_prep_minutes(
            item_weights,
            int(active_items or 0),
            outlet.kitchen_capacity,
            historical_durations,
        )
    except Exception:
        logger.exception("Prep estimate failed for outlet %s; using safe fallback", outlet.id)
        estimate, breakdown = fallback_prep_minutes(outlet.min_prep_minutes, int(active_count or 0))
    placed_at = _now_utc()
    promised_at = calculate_promised_at(placed_at, outlet.min_prep_minutes, active_count or 0, ai_estimate_minutes=estimate)
    order: Order | None = None
    for attempt in range(10):
        order = Order(
            public_id=await _new_public_id(session),
            outlet_id=outlet.id,
            user_id=user.id,
            status="placed",
            payment_method=payload.payment_method,
            payment_status="pending",
            total_inr=total,
            items_subtotal_inr=subtotal,
            coupon_discount_inr=coupon_off,
            points_discount_inr=points_off,
            delivery_fee_inr=fee,
            coupon_code=coupon.code if coupon else None,
            redeemed_points=payload.redeem_points,
            delivery_address=payload.delivery_address.address,
            delivery_lat=payload.delivery_address.lat,
            delivery_lng=payload.delivery_address.lng,
            notes=payload.notes,
            placed_at=placed_at,
            promised_at=promised_at,
            ai_estimate_minutes=estimate,
            estimate_breakdown=breakdown,
        )
        order.items.extend(
            OrderItem(
                item_id=item.item_id,
                variant_id=item.variant_id,
                name=item.name,
                unit_price_inr=item.unit_price_inr,
                quantity=item.quantity,
                addons=item.addons,
            )
            for item in items
        )
        order.status_events.append(OrderStatusEvent(status="placed", at=placed_at))
        session.add(order)
        # The point debit must commit with the order itself: the SELECT FOR
        # UPDATE taken here holds the row lock until this single commit, so a
        # concurrent checkout cannot redeem the same points twice. The balance
        # is re-validated with a fresh locked read on every attempt, because
        # the public-id retry rollback releases the lock.
        try:
            await session.flush()
            if payload.redeem_points:
                account = await get_or_create_account(session, user.id, lock=True)
                valid_points, point_reason = validate_redemption(payload.redeem_points, account.balance_points, before_points)
                if not valid_points:
                    raise HTTPException(status_code=422, detail=point_reason or "Points cannot be redeemed.")
                account.balance_points -= payload.redeem_points
                session.add(LoyaltyTransaction(user_id=user.id, order_id=order.id, type="redeem", points=-payload.redeem_points, balance_after=account.balance_points, note="Redeemed at checkout"))
            if coupon:
                session.add(CouponRedemption(coupon_id=coupon.id, user_id=user.id, order_id=order.id))
            await session.commit()
            break
        except IntegrityError as error:
            await session.rollback()
            if (
                getattr(error.orig, "constraint_name", None) != "orders_public_id_key"
                or attempt == 9
            ):
                raise
    else:
        raise HTTPException(status_code=503, detail="Could not allocate an order number. Please retry.")
    if order is None:
        raise HTTPException(status_code=503, detail="Could not allocate an order number. Please retry.")
    order = await _get_order(session, order.public_id)
    return serialize_order(order)

async def _quote(session: AsyncSession, outlet_id: UUID, lines, user: User | None, redeem_points: int = 0, coupon_code: str | None = None) -> dict[str, object]:
    outlet = await session.get(Outlet, outlet_id)
    if outlet is None: raise HTTPException(status_code=404, detail="Outlet not found.")
    _, subtotal, _ = await _calculate_cart(session, outlet, lines)
    coupon, coupon_off, coupon_reason = await _coupon_for(session, coupon_code, user, subtotal)
    fee, before_points, points_off, total = compute_totals(subtotal, coupon_off, redeem_points)
    balance = 0
    if user: balance = (await get_or_create_account(session, user.id)).balance_points
    valid, reason = validate_redemption(redeem_points, balance, before_points)
    if not valid: raise HTTPException(status_code=422, detail=reason or "Points cannot be redeemed.")
    return {"items_subtotal_inr": subtotal, "coupon_discount_inr": coupon_off, "points_discount_inr": points_off, "delivery_fee_inr": fee, "total_inr": total, "coupon_code": coupon.code if coupon else None, "coupon_reason": coupon_reason, "earn_points": earn_points(max(0, subtotal - coupon_off)), "price_note": "Item prices incl. 5% GST. Delivery fee is separate and has no additional GST in this summary."}

@router.post("/orders/quote")
async def order_quote(payload: OrderQuote, user: User | None = Depends(get_optional_user), session: AsyncSession = Depends(get_db)) -> dict[str, object]:
    return await _quote(session, payload.outlet_id, payload.items, user, payload.redeem_points, payload.coupon_code)

@router.post("/coupons/validate")
async def validate_coupon(payload: CouponValidate, user: User = Depends(require_role("customer")), session: AsyncSession = Depends(get_db)) -> dict[str, object]:
    quote = await _quote(session, payload.outlet_id, payload.items, user, 0, payload.code)
    if not quote["coupon_code"]: return {"valid": False, "code": payload.code.upper(), "discount_inr": 0, "reason": quote["coupon_reason"] or "Coupon cannot be applied."}
    return {"valid": True, "code": quote["coupon_code"], "discount_inr": quote["coupon_discount_inr"], "reason": None}

def _coupon_description(coupon: Coupon) -> str:
    if coupon.type == "percent":
        text = f"{coupon.value}% off"
        if coupon.max_discount_inr is not None: text += f" up to Rs {coupon.max_discount_inr}"
    else:
        text = f"Rs {coupon.value} off"
    return text

@router.post("/coupons/eligible")
async def eligible_coupons(payload: CouponEligible, user: User = Depends(require_role("customer")), session: AsyncSession = Depends(get_db)) -> list[dict[str, object]]:
    """Every active demo coupon for this cart; reuse the /coupons/validate rules so ineligible rows carry their reason."""
    outlet = await session.get(Outlet, payload.outlet_id)
    if outlet is None: raise HTTPException(status_code=404, detail="Outlet not found.")
    _, subtotal, _ = await _calculate_cart(session, outlet, payload.items)
    coupons = (await session.scalars(select(Coupon).where(Coupon.is_demo.is_(True), Coupon.active.is_(True)).order_by(Coupon.code))).all()
    offers: list[dict[str, object]] = []
    for coupon in coupons:
        _, discount, reason = await _coupon_for(session, coupon.code, user, subtotal)
        offers.append({"code": coupon.code, "description": _coupon_description(coupon), "eligible": reason is None, "discount_inr": discount, "reason": reason})
    return offers

@router.get("/loyalty/me")
async def loyalty_me(user: User = Depends(require_role("customer")), session: AsyncSession = Depends(get_db)) -> dict[str, object]:
    account = await get_or_create_account(session, user.id)
    transactions = (await session.scalars(select(LoyaltyTransaction).where(LoyaltyTransaction.user_id == user.id).order_by(LoyaltyTransaction.created_at.desc()).limit(20))).all()
    from app.services.rewards import tier_for
    return {"balance_points": account.balance_points, "value_inr": points_discount(account.balance_points), "tier": tier_for(account.lifetime_points), "lifetime_points": account.lifetime_points, "next_tier_points": 1500 if account.lifetime_points < 1500 else None, "transactions": [{"type": t.type, "points": t.points, "balance_after": t.balance_after, "note": t.note, "created_at": t.created_at} for t in transactions]}


@router.post("/orders/{public_id}/pay")
async def pay_order(
    public_id: str,
    payload: PaymentRequest,
    user: User = Depends(require_role("customer")),
    session: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    order = await _get_order(session, public_id)
    if order.user_id != user.id:
        raise HTTPException(status_code=404, detail="Order not found.")
    if order.payment_status == "paid":
        return {"public_id": order.public_id, "payment_status": "paid"}
    upi_id = payload.upi_id.strip() if payload.upi_id else None
    card_number = re.sub(r"\s+", "", payload.card_number) if payload.card_number else None
    if upi_id and card_number:
        raise HTTPException(
            status_code=422,
            detail="Provide either a UPI ID or a card number, not both.",
        )
    if upi_id:
        order.payment_method = "upi"
        order.payment_status = "failed" if upi_id.endswith("@fail") else "paid"
    elif card_number:
        order.payment_method = "card"
        order.payment_status = (
            "failed" if card_number == "4000000000000002" else "paid"
        )
    else:
        raise HTTPException(
            status_code=422,
            detail="Provide a UPI ID or a card number for this payment.",
        )
    await session.commit()
    order = await _get_order(session, public_id)
    await publish_order_event(order)
    return {
        "public_id": order.public_id,
        "payment_status": order.payment_status,
    }


@router.post("/orders/{public_id}/cancel")
async def cancel_order(
    public_id: str,
    payload: CancelRequest,
    user: User = Depends(require_role("customer")),
    session: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """Customers may cancel their own order while it is unpaid; the kitchen keeps paid order handling."""
    order = await _get_order(session, public_id)
    if order.user_id != user.id:
        raise HTTPException(status_code=404, detail="Order not found.")
    if order.payment_status == "paid":
        raise HTTPException(status_code=409, detail="Paid orders can only be cancelled by the kitchen.")
    if "cancelled" not in TRANSITIONS.get(order.status, set()):
        raise HTTPException(status_code=409, detail=f"Cannot cancel an order from {order.status}.")
    order = await cancel_unpaid_order(session, order, reason=payload.reason)
    return serialize_order(order)


@router.get("/orders/mine")
async def my_orders(
    limit: int = Query(default=20, ge=1, le=100),
    user: User = Depends(require_role("customer")),
    session: AsyncSession = Depends(get_db),
) -> list[dict[str, object]]:
    orders = (
        await session.scalars(
            select(Order)
            .options(*order_load_options())
            .where(Order.user_id == user.id)
            .order_by(Order.placed_at.desc())
            .limit(limit)
        )
    ).all()
    return [serialize_order(order) for order in orders]


@router.get("/orders/{public_id}")
async def get_order(
    public_id: str,
    user: User = Depends(require_role("customer")),
    session: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    order = await _get_order(session, public_id)
    if order.user_id != user.id:
        raise HTTPException(status_code=404, detail="Order not found.")
    return serialize_order(order)


@router.get("/orders/{public_id}/tracking")
async def track_order(
    public_id: str,
    user: User = Depends(require_role("customer")),
    session: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    order = await _get_order(session, public_id)
    if order.user_id != user.id:
        raise HTTPException(status_code=404, detail="Order not found.")
    if order.delivery_lat is None or order.delivery_lng is None:
        raise HTTPException(status_code=409, detail="This order has no delivery location.")
    outlet = await session.get(Outlet, order.outlet_id)
    rider = order.rider
    route = generate_route((outlet.lat, outlet.lng), (order.delivery_lat, order.delivery_lng), order.id)
    duration = trip_duration(route)
    progress = delivery_progress(order.picked_up_at, _now_utc(), duration)
    stage = derive_stage(status=order.status, rider_assigned_at=order.rider_assigned_at, picked_up_at=order.picked_up_at, delivered_at=order.delivered_at, progress=progress)
    position, heading = interpolate_route(route, progress)
    eta_at = order.delivery_eta_at or (order.picked_up_at + duration if order.picked_up_at else None)
    minutes = max(0, round((eta_at - _now_utc()).total_seconds() / 60)) if eta_at else None
    return {
        "stage": stage,
        "rider": {"name": rider.name, "vehicle": rider.vehicle_number, "rating": rider.rating, "masked_phone": rider.masked_phone, "fictional": True} if rider else None,
        "route": [{"lat": lat, "lng": lng} for lat, lng in route],
        "current_position": {"lat": position[0], "lng": position[1]},
        "heading": heading,
        "progress": progress,
        "eta_at": eta_at,
        "minutes_remaining": minutes,
        "outlet": {"lat": outlet.lat, "lng": outlet.lng, "name": outlet.name},
        "destination": {"lat": order.delivery_lat, "lng": order.delivery_lng, "address": order.delivery_address},
        "distance_km": round(route_distance_km(route), 2),
    }


@kitchen_router.get("/orders")
async def kitchen_orders(
    user: User = Depends(require_role("kitchen")),
    session: AsyncSession = Depends(get_db),
) -> list[dict[str, object]]:
    orders = (
        await session.scalars(
            select(Order)
            .options(*order_load_options())
            .where(
                Order.outlet_id == user.outlet_id,
                Order.payment_status == "paid",
                Order.status.in_(KITCHEN_VISIBLE_STATUSES),
            )
            .order_by(Order.promised_at.asc(), Order.placed_at.asc())
        )
    ).all()
    return [serialize_order(order) for order in orders]


@kitchen_router.patch("/orders/{public_id}/status")
async def update_order_status(
    public_id: str,
    payload: StatusUpdate,
    user: User = Depends(require_role("kitchen")),
    session: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    order = await _get_order(session, public_id)
    if order.outlet_id != user.outlet_id:
        raise HTTPException(status_code=404, detail="Order not found.")
    if order.payment_status != "paid":
        raise HTTPException(status_code=409, detail="Only paid orders can be processed.")
    if payload.status not in TRANSITIONS.get(order.status, set()):
        raise HTTPException(status_code=409, detail=f"Cannot move an order from {order.status} to {payload.status}.")
    now = _now_utc()
    order.status = payload.status
    event_message: str | None = None
    if payload.status == "preparing" and order.rider_id is None:
        riders = (await session.scalars(select(Rider).where(Rider.is_available.is_(True)).order_by(Rider.id))).all()
        if riders:
            assigned_count = await session.scalar(select(func.count(Order.id)).where(Order.rider_id.is_not(None))) or 0
            order.rider = riders[assigned_count % len(riders)]
            order.rider_assigned_at = now
            event_message = f"Rider {order.rider.name} is on the way to the restaurant"
    if payload.status == "handed_to_rider":
        if order.rider_id is None:
            raise HTTPException(status_code=409, detail="A rider must be assigned before handoff.")
        order.picked_up_at = now
        outlet = await session.get(Outlet, order.outlet_id)
        route = generate_route((outlet.lat, outlet.lng), (order.delivery_lat, order.delivery_lng), order.id)
        order.delivery_eta_at = now + trip_duration(route)
    if payload.status == "cancelled":
        order.cancellation_reason = payload.reason
        if order.payment_status != "paid" and order.coupon_redemption is not None:
            await session.delete(order.coupon_redemption)
        await settle_order_rewards(session, order)
    if payload.status == "delivered":
        await settle_order_rewards(session, order)
    order.status_events.append(OrderStatusEvent(status=payload.status, at=now))
    await session.commit()
    order = await _get_order(session, public_id)
    await publish_order_event(order, event_type="order.updated", message=event_message)
    return serialize_order(order)


@kitchen_router.patch("/orders/{public_id}/override")
async def override_promised_time(
    public_id: str,
    payload: OverrideUpdate,
    user: User = Depends(require_role("kitchen")),
    session: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    order = await _get_order(session, public_id)
    if order.outlet_id != user.outlet_id:
        raise HTTPException(status_code=404, detail="Order not found.")
    outlet = await session.get(Outlet, order.outlet_id)
    order.manager_override_minutes = payload.minutes
    order.promised_at = calculate_promised_at(
        order.placed_at,
        outlet.min_prep_minutes,
        0,
        ai_estimate_minutes=order.ai_estimate_minutes,
        manager_override_minutes=payload.minutes,
    )
    await session.commit()
    order = await _get_order(session, public_id)
    await publish_order_event(order, event_type="order.updated")
    return serialize_order(order)


@kitchen_router.post("/orders/{public_id}/acknowledge-escalation")
async def acknowledge_escalation(
    public_id: str,
    user: User = Depends(require_role("kitchen")),
    session: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    order = await _get_order(session, public_id)
    if order.outlet_id != user.outlet_id:
        raise HTTPException(status_code=404, detail="Order not found.")
    if order.escalated_at is None:
        raise HTTPException(status_code=409, detail="This order has not been escalated.")
    order.escalation_acknowledged_at = _now_utc()
    await session.commit()
    order = await _get_order(session, public_id)
    await publish_order_event(order, event_type="order.updated")
    return serialize_order(order)


@kitchen_router.get("/items")
async def kitchen_items(
    user: User = Depends(require_role("kitchen")),
    session: AsyncSession = Depends(get_db),
) -> list[dict[str, object]]:
    rows = (
        await session.execute(
            select(
                MenuItem,
                Category.name.label("category_name"),
                OutletItemAvailability.available,
            )
            .join(Category, Category.id == MenuItem.category_id)
            .outerjoin(
                OutletItemAvailability,
                and_(
                    OutletItemAvailability.item_id == MenuItem.id,
                    OutletItemAvailability.outlet_id == user.outlet_id,
                ),
            )
            .where(MenuItem.active.is_(True))
            .order_by(Category.sort_order, MenuItem.sort_order, MenuItem.name)
        )
    ).all()
    return [
        {
            "id": str(item.id),
            "name": item.name,
            "category": category_name,
            "available": bool(available),
            "is_veg": item.is_veg,
            "spice_level": item.spice_level,
        }
        for item, category_name, available in rows
    ]


@kitchen_router.patch("/outlets/{outlet_id}/items/{item_id}/availability")
async def kitchen_item_availability(
    outlet_id: UUID,
    item_id: UUID,
    payload: AvailabilityUpdate,
    user: User = Depends(require_role("kitchen")),
    session: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    if user.outlet_id != outlet_id:
        raise HTTPException(status_code=403, detail="Kitchen users can only change their own outlet.")
    return await _set_availability(outlet_id, item_id, payload.available, session)
