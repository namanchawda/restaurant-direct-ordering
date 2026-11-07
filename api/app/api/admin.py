from datetime import date, datetime, time, timedelta
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, extract, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_role
from app.core.config import get_settings
from app.models import (
    Addon,
    Category,
    CityPrice,
    ItemAddon,
    ItemVariant,
    MenuItem,
    Order,
    OrderStatusEvent,
    Outlet,
    OutletItemAvailability,
    User,
    Rider,
    Coupon,
)
from app.schemas import (
    AddonCreate,
    AddonUpdate,
    AvailabilityUpdate,
    CategoryCreate,
    CategoryUpdate,
    CityPriceCreate,
    CityPriceUpdate,
    MenuItemCreate,
    MenuItemUpdate,
    CouponCreate,
    CouponUpdate,
)
from app.services.delivery import generate_route, trip_duration
from app.services.events import publish_order_event
from app.services.order_payload import order_load_options, serialize_order
from app.services.rewards import settle_order_rewards

router = APIRouter(prefix="/admin", tags=["admin"])

def _coupon_data(coupon: Coupon) -> dict[str, object]:
    return {"id": str(coupon.id), "code": coupon.code, "type": coupon.type, "value": coupon.value, "min_order_inr": coupon.min_order_inr, "max_discount_inr": coupon.max_discount_inr, "valid_from": coupon.valid_from, "valid_to": coupon.valid_to, "usage_limit_total": coupon.usage_limit_total, "usage_limit_per_user": coupon.usage_limit_per_user, "first_order_only": coupon.first_order_only, "active": coupon.active, "is_demo": coupon.is_demo}

@router.get("/coupons")
async def list_coupons(_: User = Depends(require_role("admin")), session: AsyncSession = Depends(get_db)) -> list[dict[str, object]]:
    return [_coupon_data(c) for c in (await session.scalars(select(Coupon).order_by(Coupon.code))).all()]

@router.post("/coupons", status_code=201)
async def create_coupon(payload: CouponCreate, _: User = Depends(require_role("admin")), session: AsyncSession = Depends(get_db)) -> dict[str, object]:
    coupon = Coupon(**payload.model_dump(exclude_unset=True, exclude={"code"}), code=payload.code.strip().upper())
    session.add(coupon)
    try: await session.commit()
    except IntegrityError: await session.rollback(); raise HTTPException(status_code=409, detail="Coupon code already exists.") from None
    await session.refresh(coupon); return _coupon_data(coupon)

@router.patch("/coupons/{coupon_id}")
async def update_coupon(coupon_id: UUID, payload: CouponUpdate, _: User = Depends(require_role("admin")), session: AsyncSession = Depends(get_db)) -> dict[str, object]:
    coupon = await session.get(Coupon, coupon_id)
    if coupon is None: raise HTTPException(status_code=404, detail="Coupon not found.")
    for key, value in payload.model_dump(exclude_unset=True).items(): setattr(coupon, key, value)
    await session.commit(); await session.refresh(coupon); return _coupon_data(coupon)


@router.post("/demo/advance-order")
async def demo_advance_order(
    payload: dict[str, str],
    user: User = Depends(require_role("admin")),
    session: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    if get_settings().environment.lower() in {"production", "prod"}:
        raise HTTPException(status_code=404, detail="Demo helpers are disabled in production.")
    public_id = payload.get("public_id", "")
    order = await session.scalar(select(Order).options(*order_load_options()).where(Order.public_id == public_id))
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found.")
    next_status = {"placed": "accepted", "accepted": "preparing", "preparing": "ready_for_pickup", "ready_for_pickup": "handed_to_rider", "handed_to_rider": "delivered"}.get(order.status)
    if next_status is None:
        raise HTTPException(status_code=409, detail="This order has no demo status to advance to.")
    now = datetime.now(ZoneInfo("UTC"))
    order.status = next_status
    if next_status == "preparing" and order.rider_id is None:
        rider = await session.scalar(select(Rider).where(Rider.is_available.is_(True)).order_by(Rider.id))
        if rider:
            order.rider = rider
            order.rider_assigned_at = now
    if next_status == "handed_to_rider":
        order.picked_up_at = now
        route = generate_route((order.outlet.lat, order.outlet.lng), (order.delivery_lat, order.delivery_lng), order.id)
        order.delivery_eta_at = now + trip_duration(route)
    if next_status == "delivered":
        if order.picked_up_at is None:
            raise HTTPException(status_code=409, detail="Cannot deliver before pickup.")
        order.delivered_at = now
    if next_status in {"delivered", "cancelled"}:
        if next_status == "cancelled" and order.payment_status != "paid" and order.coupon_redemption is not None:
            await session.delete(order.coupon_redemption)
        await settle_order_rewards(session, order)
    order.status_events.append(OrderStatusEvent(status=next_status, at=now))
    await session.commit()
    order = await session.scalar(select(Order).options(*order_load_options()).where(Order.public_id == public_id))
    await publish_order_event(order, event_type="order.updated")
    return serialize_order(order)


_IST = ZoneInfo("Asia/Kolkata")


def _dashboard_range(
    from_date: datetime | None, to_date: datetime | None
) -> tuple[datetime, datetime]:
    today = datetime.now(_IST).date()
    start_day = from_date.astimezone(_IST).date() if from_date and from_date.tzinfo else (
        from_date.date() if from_date else None
    )
    end_day = to_date.astimezone(_IST).date() if to_date and to_date.tzinfo else (
        to_date.date() if to_date else None
    )
    end_day = end_day or today
    start_day = start_day or end_day - timedelta(days=6)

    if start_day > end_day:
        raise HTTPException(status_code=422, detail="'from' must be on or before 'to'.")
    if (end_day - start_day).days + 1 > 90:
        raise HTTPException(status_code=422, detail="The requested range cannot exceed 90 days.")

    start = datetime.combine(start_day, time.min, tzinfo=_IST)
    end_exclusive = datetime.combine(end_day + timedelta(days=1), time.min, tzinfo=_IST)
    return start, end_exclusive


def _empty_dashboard_metrics() -> dict[str, Any]:
    return {
        "orders_count": 0,
        "revenue_inr": 0,
        "coupon_discount_inr": 0,
        "points_discount_inr": 0,
        "avg_order_value_inr": None,
        "avg_promised_minutes": None,
        "median_promised_minutes": None,
        "avg_actual_minutes": None,
        "median_actual_minutes": None,
        "on_time_rate": None,
        "late_count": 0,
        "escalated_count": 0,
        "cancellations_count": 0,
        "cancellations": [],
        "repeat_customer_pct": None,
        "orders_by_hour": [{"hour": hour, "orders_count": 0} for hour in range(24)],
    }


def _rounded(value: Any) -> float | None:
    return round(float(value), 2) if value is not None else None


async def dashboard_data(
    user: User, session: AsyncSession, outlet_id: UUID | None = None,
    from_date: datetime | None = None, to_date: datetime | None = None,
) -> dict[str, object]:
    start, end_exclusive = _dashboard_range(from_date, to_date)
    conditions = [
        Order.payment_status == "paid",
        Order.placed_at >= start,
        Order.placed_at < end_exclusive,
    ]
    if outlet_id is not None:
        conditions.append(Order.outlet_id == outlet_id)

    ready_events = (
        select(
            OrderStatusEvent.order_id.label("order_id"),
            func.min(OrderStatusEvent.at).label("ready_at"),
        )
        .where(OrderStatusEvent.status == "ready_for_pickup")
        .group_by(OrderStatusEvent.order_id)
        .subquery()
    )
    promised_minutes = extract("epoch", Order.promised_at - Order.placed_at) / 60.0
    actual_minutes = extract("epoch", ready_events.c.ready_at - Order.placed_at) / 60.0

    async def metric_rows(group_by_outlet: bool) -> list[Any]:
        columns = []
        if group_by_outlet:
            columns.extend(
                [Outlet.id.label("outlet_id"), Outlet.name.label("outlet_name")]
            )
        columns.extend(
            [
                func.count(Order.id).label("orders_count"),
                func.coalesce(func.sum(Order.total_inr), 0).label("revenue_inr"),
                func.coalesce(func.sum(Order.coupon_discount_inr), 0).label("coupon_discount_inr"),
                func.coalesce(func.sum(Order.points_discount_inr), 0).label("points_discount_inr"),
                func.avg(Order.total_inr).label("avg_order_value_inr"),
                func.avg(promised_minutes).label("avg_promised_minutes"),
                func.percentile_cont(0.5).within_group(promised_minutes).label(
                    "median_promised_minutes"
                ),
                func.avg(actual_minutes)
                .filter(ready_events.c.ready_at.is_not(None))
                .label("avg_actual_minutes"),
                func.percentile_cont(0.5)
                .within_group(actual_minutes)
                .filter(ready_events.c.ready_at.is_not(None))
                .label("median_actual_minutes"),
                (
                    100.0
                    * func.count()
                    .filter(
                        ready_events.c.ready_at.is_not(None),
                        ready_events.c.ready_at <= Order.promised_at,
                    )
                    / func.nullif(
                        func.count().filter(ready_events.c.ready_at.is_not(None)), 0
                    )
                ).label("on_time_rate"),
                func.count()
                .filter(
                    ready_events.c.ready_at.is_not(None),
                    ready_events.c.ready_at > Order.promised_at,
                )
                .label("late_count"),
                func.count()
                .filter(Order.escalated_at.is_not(None))
                .label("escalated_count"),
                func.count()
                .filter(Order.status == "cancelled")
                .label("cancellations_count"),
            ]
        )
        statement = (
            select(*columns)
            .select_from(Order)
            .join(Outlet, Outlet.id == Order.outlet_id)
            .outerjoin(ready_events, ready_events.c.order_id == Order.id)
            .where(*conditions)
        )
        if group_by_outlet:
            statement = statement.group_by(Outlet.id, Outlet.name).order_by(Outlet.name)
        return list((await session.execute(statement)).all())

    outlet_rows = await metric_rows(group_by_outlet=True)
    total_row = (await metric_rows(group_by_outlet=False))[0]

    outlets = (
        await session.execute(
            select(Outlet.id, Outlet.name)
            .where(*([Outlet.id == outlet_id] if outlet_id is not None else []))
            .order_by(Outlet.name)
        )
    ).all()
    per_outlet = {
        outlet.id: {
            "outlet_id": str(outlet.id),
            "outlet": outlet.name,
            **_empty_dashboard_metrics(),
        }
        for outlet in outlets
    }
    overall = _empty_dashboard_metrics()

    def apply_metric_row(metrics: dict[str, Any], row: Any) -> None:
        for key in (
            "orders_count",
            "revenue_inr",
            "coupon_discount_inr",
            "points_discount_inr",
            "late_count",
            "escalated_count",
            "cancellations_count",
        ):
            metrics[key] = int(row._mapping[key] or 0)
        for key in (
            "avg_order_value_inr",
            "avg_promised_minutes",
            "median_promised_minutes",
            "avg_actual_minutes",
            "median_actual_minutes",
            "on_time_rate",
        ):
            metrics[key] = _rounded(row._mapping[key])

    for row in outlet_rows:
        apply_metric_row(per_outlet[row.outlet_id], row)
    apply_metric_row(overall, total_row)

    repeat_orders = (
        select(
            Order.outlet_id.label("outlet_id"),
            Order.user_id.label("user_id"),
            func.count(Order.id).label("orders_count"),
        )
        .where(*conditions)
        .group_by(Order.outlet_id, Order.user_id)
        .subquery()
    )
    repeat_rows = (
        await session.execute(
            select(
                repeat_orders.c.outlet_id,
                func.count()
                .filter(repeat_orders.c.orders_count >= 2)
                .label("repeat_customers"),
                func.count().label("customers_count"),
            ).group_by(repeat_orders.c.outlet_id)
        )
    ).all()
    total_repeat_orders = (
        select(
            Order.user_id.label("user_id"),
            func.count(Order.id).label("orders_count"),
        )
        .where(*conditions)
        .group_by(Order.user_id)
        .subquery()
    )
    total_repeats = (
        await session.execute(
            select(
                func.count()
                .filter(total_repeat_orders.c.orders_count >= 2)
                .label("repeat_customers"),
                func.count().label("customers_count"),
            ).select_from(total_repeat_orders)
        )
    ).one()

    def repeat_percentage(repeats: int, customers: int) -> float | None:
        return round(repeats * 100.0 / customers, 2) if customers else None

    for row in repeat_rows:
        per_outlet[row.outlet_id]["repeat_customer_pct"] = repeat_percentage(
            int(row.repeat_customers), int(row.customers_count)
        )
    overall["repeat_customer_pct"] = repeat_percentage(
        int(total_repeats.repeat_customers), int(total_repeats.customers_count)
    )

    async def cancellation_rows(group_by_outlet: bool) -> list[Any]:
        columns = []
        if group_by_outlet:
            columns.append(Outlet.id.label("outlet_id"))
        columns.extend(
            [
                Order.cancellation_reason.label("reason"),
                func.count(Order.id).label("count"),
            ]
        )
        statement = (
            select(*columns)
            .select_from(Order)
            .join(Outlet, Outlet.id == Order.outlet_id)
            .where(*conditions, Order.status == "cancelled")
            .group_by(
                *(
                    [Outlet.id, Order.cancellation_reason]
                    if group_by_outlet
                    else [Order.cancellation_reason]
                )
            )
            .order_by(Order.cancellation_reason)
        )
        return list((await session.execute(statement)).all())

    for row in await cancellation_rows(group_by_outlet=True):
        per_outlet[row.outlet_id]["cancellations"].append(
            {"reason": row.reason, "count": int(row.count)}
        )
    overall["cancellations"] = [
        {"reason": row.reason, "count": int(row.count)}
        for row in await cancellation_rows(group_by_outlet=False)
    ]

    hour = extract("hour", func.timezone("Asia/Kolkata", Order.placed_at))

    async def hourly_rows(group_by_outlet: bool) -> list[Any]:
        columns = []
        if group_by_outlet:
            columns.append(Outlet.id.label("outlet_id"))
        columns.extend([hour.label("hour"), func.count(Order.id).label("orders_count")])
        statement = (
            select(*columns)
            .select_from(Order)
            .join(Outlet, Outlet.id == Order.outlet_id)
            .where(*conditions)
            .group_by(*(([Outlet.id, hour]) if group_by_outlet else [hour]))
            .order_by(hour)
        )
        return list((await session.execute(statement)).all())

    for row in await hourly_rows(group_by_outlet=True):
        per_outlet[row.outlet_id]["orders_by_hour"][int(row.hour)]["orders_count"] = int(
            row.orders_count
        )
    for row in await hourly_rows(group_by_outlet=False):
        overall["orders_by_hour"][int(row.hour)]["orders_count"] = int(row.orders_count)

    for metrics in [*per_outlet.values(), overall]:
        metrics["orders"] = metrics["orders_count"]
        metrics["average_order_value_inr"] = metrics["avg_order_value_inr"]

    return {
        "from": start.isoformat(),
        "to": (end_exclusive - timedelta(microseconds=1)).isoformat(),
        "headline": {
            "orders": overall["orders_count"],
            "revenue_inr": overall["revenue_inr"],
            "average_order_value_inr": overall["avg_order_value_inr"] or 0,
            "definition": "Total payable after coupon and points discounts; item prices incl. 5% GST.",
            "coupon_discount_inr": overall["coupon_discount_inr"],
            "points_discount_inr": overall["points_discount_inr"],
        },
        "total": overall,
        "outlets": list(per_outlet.values()),
        "orders_by_hour": overall["orders_by_hour"],
        "cancellations_by_reason": overall["cancellations"],
    }

@router.get("/dashboard")
async def dashboard(
    from_date: datetime | None = Query(None, alias="from"),
    to_date: datetime | None = Query(None, alias="to"),
    outlet_id: UUID | None = None,
    user: User = Depends(require_role("admin")), session: AsyncSession = Depends(get_db)
) -> dict[str, object]:
    return await dashboard_data(user, session, outlet_id, from_date, to_date)


async def _commit(session: AsyncSession) -> None:
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status_code=409, detail="This change conflicts with existing menu data."
        ) from None


def _category_data(category: Category) -> dict[str, object]:
    return {
        "id": str(category.id),
        "name": category.name,
        "sort_order": category.sort_order,
        "available_from": category.available_from,
        "available_to": category.available_to,
    }


@router.get("/categories")
async def list_categories(
    _: User = Depends(require_role("admin")), session: AsyncSession = Depends(get_db)
) -> list[dict[str, object]]:
    categories = (await session.scalars(select(Category).order_by(Category.sort_order))).all()
    return [_category_data(category) for category in categories]


@router.post("/categories", status_code=status.HTTP_201_CREATED)
async def create_category(
    payload: CategoryCreate,
    _: User = Depends(require_role("admin")),
    session: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    category = Category(**payload.model_dump())
    session.add(category)
    await _commit(session)
    await session.refresh(category)
    return _category_data(category)


@router.patch("/categories/{category_id}")
async def update_category(
    category_id: UUID,
    payload: CategoryUpdate,
    _: User = Depends(require_role("admin")),
    session: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    category = await session.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found.")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(category, key, value)
    await _commit(session)
    await session.refresh(category)
    return _category_data(category)


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(
    category_id: UUID,
    _: User = Depends(require_role("admin")),
    session: AsyncSession = Depends(get_db),
) -> None:
    category = await session.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found.")
    await session.delete(category)
    await _commit(session)


def _item_data(item: MenuItem) -> dict[str, object]:
    return {
        "id": str(item.id),
        "category_id": str(item.category_id),
        "name": item.name,
        "description": item.description,
        "photo_url": item.photo_url,
        "is_veg": item.is_veg,
        "spice_level": item.spice_level,
        "allergens": item.allergens,
        "base_price_inr": item.base_price_inr,
        "active": item.active,
        "sort_order": item.sort_order,
        "variants": [
            {"id": str(variant.id), "name": variant.name, "price_inr": variant.price_inr}
            for variant in item.variants
        ],
        "addon_ids": [str(link.addon_id) for link in item.addon_links],
    }


def _item_options():
    return (
        selectinload(MenuItem.variants),
        selectinload(MenuItem.addon_links),
    )


async def _replace_item_links(
    item: MenuItem,
    variants: list[dict[str, object]] | None,
    addon_ids: list[UUID] | None,
    session: AsyncSession,
) -> None:
    if variants is not None:
        item.variants.clear()
        await session.flush()
        item.variants.extend(ItemVariant(name=variant["name"], price_inr=variant["price_inr"]) for variant in variants)
    if addon_ids is not None:
        if len(set(addon_ids)) != len(addon_ids):
            raise HTTPException(status_code=422, detail="Addon IDs must be unique.")
        if addon_ids:
            found = set(
                (await session.scalars(select(Addon.id).where(Addon.id.in_(addon_ids)))).all()
            )
            if found != set(addon_ids):
                raise HTTPException(status_code=422, detail="One or more addons do not exist.")
        item.addon_links.clear()
        await session.flush()
        item.addon_links.extend(ItemAddon(addon_id=addon_id) for addon_id in addon_ids)


@router.get("/items")
async def list_items(
    _: User = Depends(require_role("admin")), session: AsyncSession = Depends(get_db)
) -> list[dict[str, object]]:
    items = (
        await session.scalars(
            select(MenuItem).options(*_item_options()).order_by(MenuItem.sort_order)
        )
    ).all()
    return [_item_data(item) for item in items]


@router.get("/items/{item_id}/availability")
async def list_item_availability(
    item_id: UUID,
    _: User = Depends(require_role("admin")),
    session: AsyncSession = Depends(get_db),
) -> list[dict[str, object]]:
    if await session.get(MenuItem, item_id) is None:
        raise HTTPException(status_code=404, detail="Menu item not found.")
    rows = (
        await session.execute(
            select(Outlet, OutletItemAvailability.available)
            .outerjoin(
                OutletItemAvailability,
                (OutletItemAvailability.outlet_id == Outlet.id)
                & (OutletItemAvailability.item_id == item_id),
            )
            .order_by(Outlet.name)
        )
    ).all()
    return [
        {
            "id": str(outlet.id),
            "name": outlet.name,
            "city": outlet.city,
            "available": available if available is not None else False,
        }
        for outlet, available in rows
    ]


@router.post("/items", status_code=status.HTTP_201_CREATED)
async def create_item(
    payload: MenuItemCreate,
    _: User = Depends(require_role("admin")),
    session: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    if await session.get(Category, payload.category_id) is None:
        raise HTTPException(status_code=422, detail="Category does not exist.")
    values = payload.model_dump(exclude={"variants", "addon_ids"})
    item = MenuItem(**values)
    session.add(item)
    await session.flush()
    await _replace_item_links(
        item,
        [variant.model_dump() for variant in payload.variants],
        payload.addon_ids,
        session,
    )
    await _commit(session)
    item = await session.scalar(
        select(MenuItem).options(*_item_options()).where(MenuItem.id == item.id)
    )
    return _item_data(item)


@router.patch("/items/{item_id}")
async def update_item(
    item_id: UUID,
    payload: MenuItemUpdate,
    _: User = Depends(require_role("admin")),
    session: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    item = await session.scalar(
        select(MenuItem).options(*_item_options()).where(MenuItem.id == item_id)
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Menu item not found.")
    values = payload.model_dump(exclude_unset=True, exclude={"variants", "addon_ids"})
    if values.get("category_id") and await session.get(Category, values["category_id"]) is None:
        raise HTTPException(status_code=422, detail="Category does not exist.")
    for key, value in values.items():
        setattr(item, key, value)
    variant_data = (
        [variant.model_dump(exclude={"id"}) for variant in payload.variants]
        if payload.variants is not None
        else None
    )
    await _replace_item_links(item, variant_data, payload.addon_ids, session)
    await _commit(session)
    item = await session.scalar(
        select(MenuItem).options(*_item_options()).where(MenuItem.id == item_id)
    )
    return _item_data(item)


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(
    item_id: UUID,
    _: User = Depends(require_role("admin")),
    session: AsyncSession = Depends(get_db),
) -> None:
    item = await session.get(MenuItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Menu item not found.")
    await session.delete(item)
    await _commit(session)


@router.get("/addons")
async def list_addons(
    _: User = Depends(require_role("admin")), session: AsyncSession = Depends(get_db)
) -> list[dict[str, object]]:
    addons = (await session.scalars(select(Addon).order_by(Addon.name))).all()
    return [{"id": str(addon.id), "name": addon.name, "price_inr": addon.price_inr} for addon in addons]


@router.post("/addons", status_code=status.HTTP_201_CREATED)
async def create_addon(
    payload: AddonCreate,
    _: User = Depends(require_role("admin")),
    session: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    addon = Addon(**payload.model_dump())
    session.add(addon)
    await _commit(session)
    await session.refresh(addon)
    return {"id": str(addon.id), "name": addon.name, "price_inr": addon.price_inr}


@router.patch("/addons/{addon_id}")
async def update_addon(
    addon_id: UUID,
    payload: AddonUpdate,
    _: User = Depends(require_role("admin")),
    session: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    addon = await session.get(Addon, addon_id)
    if addon is None:
        raise HTTPException(status_code=404, detail="Addon not found.")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(addon, key, value)
    await _commit(session)
    await session.refresh(addon)
    return {"id": str(addon.id), "name": addon.name, "price_inr": addon.price_inr}


@router.delete("/addons/{addon_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_addon(
    addon_id: UUID,
    _: User = Depends(require_role("admin")),
    session: AsyncSession = Depends(get_db),
) -> None:
    addon = await session.get(Addon, addon_id)
    if addon is None:
        raise HTTPException(status_code=404, detail="Addon not found.")
    await session.delete(addon)
    await _commit(session)


@router.get("/city-prices")
async def list_city_prices(
    _: User = Depends(require_role("admin")), session: AsyncSession = Depends(get_db)
) -> list[dict[str, object]]:
    rows = (await session.scalars(select(CityPrice).order_by(CityPrice.city))).all()
    return [
        {"id": str(row.id), "item_id": str(row.item_id), "city": row.city, "price_inr": row.price_inr}
        for row in rows
    ]


@router.post("/city-prices", status_code=status.HTTP_201_CREATED)
async def create_city_price(
    payload: CityPriceCreate,
    _: User = Depends(require_role("admin")),
    session: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    if await session.get(MenuItem, payload.item_id) is None:
        raise HTTPException(status_code=422, detail="Menu item does not exist.")
    price = CityPrice(**payload.model_dump())
    session.add(price)
    await _commit(session)
    await session.refresh(price)
    return {"id": str(price.id), "item_id": str(price.item_id), "city": price.city, "price_inr": price.price_inr}


@router.patch("/city-prices/{price_id}")
async def update_city_price(
    price_id: UUID,
    payload: CityPriceUpdate,
    _: User = Depends(require_role("admin")),
    session: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    price = await session.get(CityPrice, price_id)
    if price is None:
        raise HTTPException(status_code=404, detail="City price not found.")
    values = payload.model_dump(exclude_unset=True)
    if values.get("item_id") and await session.get(MenuItem, values["item_id"]) is None:
        raise HTTPException(status_code=422, detail="Menu item does not exist.")
    for key, value in values.items():
        setattr(price, key, value)
    await _commit(session)
    await session.refresh(price)
    return {"id": str(price.id), "item_id": str(price.item_id), "city": price.city, "price_inr": price.price_inr}


@router.delete("/city-prices/{price_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_city_price(
    price_id: UUID,
    _: User = Depends(require_role("admin")),
    session: AsyncSession = Depends(get_db),
) -> None:
    price = await session.get(CityPrice, price_id)
    if price is None:
        raise HTTPException(status_code=404, detail="City price not found.")
    await session.delete(price)
    await session.commit()


async def _set_availability(
    outlet_id: UUID,
    item_id: UUID,
    available: bool,
    session: AsyncSession,
) -> dict[str, object]:
    if await session.get(Outlet, outlet_id) is None:
        raise HTTPException(status_code=404, detail="Outlet not found.")
    if await session.get(MenuItem, item_id) is None:
        raise HTTPException(status_code=404, detail="Menu item not found.")
    row = await session.scalar(
        select(OutletItemAvailability).where(
            OutletItemAvailability.outlet_id == outlet_id,
            OutletItemAvailability.item_id == item_id,
        )
    )
    if row is None:
        row = OutletItemAvailability(outlet_id=outlet_id, item_id=item_id, available=available)
        session.add(row)
    else:
        row.available = available
    await session.commit()
    return {"outlet_id": str(outlet_id), "item_id": str(item_id), "available": row.available}


@router.patch("/outlets/{outlet_id}/items/{item_id}/availability")
async def admin_item_availability(
    outlet_id: UUID,
    item_id: UUID,
    payload: AvailabilityUpdate,
    _: User = Depends(require_role("admin")),
    session: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    return await _set_availability(outlet_id, item_id, payload.available, session)
