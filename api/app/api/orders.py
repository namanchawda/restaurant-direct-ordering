from datetime import UTC, datetime
import re
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_role
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
    User,
)
from app.schemas import (
    AvailabilityUpdate,
    OrderCreate,
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
from app.services.prep_time import calculate_promised_at

router = APIRouter(tags=["orders"])
kitchen_router = APIRouter(prefix="/kitchen", tags=["kitchen"])
TRANSITIONS = {
    "placed": {"accepted", "cancelled"},
    "accepted": {"preparing", "cancelled"},
    "preparing": {"ready_for_pickup", "cancelled"},
    "ready_for_pickup": {"handed_to_rider"},
    "handed_to_rider": {"delivered"},
}


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

    items: list[OrderItem] = []
    total = 0
    current_time = _now_utc()
    for line in payload.items:
        item = await session.scalar(
            select(MenuItem)
            .options(
                selectinload(MenuItem.variants),
                selectinload(MenuItem.addon_links).selectinload(ItemAddon.addon),
                selectinload(MenuItem.outlet_availability),
                selectinload(MenuItem.category),
                selectinload(MenuItem.city_prices),
            )
            .where(MenuItem.id == line.item_id)
        )
        if item is None or not item.active:
            raise HTTPException(status_code=409, detail="One or more menu items are unavailable.")
        is_available = any(
            row.outlet_id == outlet.id and row.available for row in item.outlet_availability
        )
        category = item.category
        in_window, _ = category_window_status(category, current_time)
        if not is_available or not in_window:
            raise HTTPException(status_code=409, detail=f"{item.name} is not available at this outlet right now.")

        base_price = next(
            (price.price_inr for price in item.city_prices if price.city.casefold() == outlet.city.casefold()),
            item.base_price_inr,
        )
        unit_price = base_price
        item_name = item.name
        if line.variant_id:
            variant = next((value for value in item.variants if value.id == line.variant_id), None)
            if variant is None:
                raise HTTPException(status_code=422, detail="The selected variant does not belong to this item.")
            unit_price = variant.price_inr
            item_name = f"{item.name} - {variant.name}"
        if len(set(line.addon_ids)) != len(line.addon_ids):
            raise HTTPException(status_code=422, detail="Addon IDs must be unique for each item.")
        allowed_addons = {link.addon_id: link.addon for link in item.addon_links}
        if any(addon_id not in allowed_addons for addon_id in line.addon_ids):
            raise HTTPException(status_code=422, detail="One or more addons are not available for this item.")
        addon_snapshots = [
            {
                "id": str(addon_id),
                "name": allowed_addons[addon_id].name,
                "price_inr": allowed_addons[addon_id].price_inr,
            }
            for addon_id in line.addon_ids
        ]
        total += (unit_price + sum(addon["price_inr"] for addon in addon_snapshots)) * line.quantity
        items.append(
            OrderItem(
                item_id=item.id,
                variant_id=line.variant_id,
                name=item_name,
                unit_price_inr=unit_price,
                quantity=line.quantity,
                addons=addon_snapshots,
            )
        )

    active_count = await session.scalar(
        select(func.count(Order.id)).where(
            Order.outlet_id == outlet.id,
            Order.status.in_(ACTIVE_STATUSES),
            Order.payment_status == "paid",
        )
    )
    placed_at = _now_utc()
    promised_at = calculate_promised_at(placed_at, outlet.min_prep_minutes, active_count or 0)
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
            delivery_address=payload.delivery_address.address,
            delivery_lat=payload.delivery_address.lat,
            delivery_lng=payload.delivery_address.lng,
            notes=payload.notes,
            placed_at=placed_at,
            promised_at=promised_at,
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
        try:
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
    order.status = payload.status
    if payload.status == "cancelled":
        order.cancellation_reason = payload.reason
    order.status_events.append(OrderStatusEvent(status=payload.status, at=_now_utc()))
    await session.commit()
    order = await _get_order(session, public_id)
    await publish_order_event(order, event_type="order.updated")
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
