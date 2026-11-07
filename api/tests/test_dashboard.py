from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, time, timedelta
import secrets
from zoneinfo import ZoneInfo

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from app.db.session import get_session_factory
from app.main import app
from app.models import (
    Category,
    MenuItem,
    Order,
    OrderItem,
    OrderStatusEvent,
    Outlet,
    OutletItemAvailability,
    User,
)
from app.seed import seed_data

IST = ZoneInfo("Asia/Kolkata")
DATASET_DAY = date(2098, 1, 10)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _login(client: httpx.AsyncClient, phone: str, password: str) -> str:
    response = await client.post(
        "/auth/login", json={"phone": phone, "password": password}
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


async def _customer_token(client: httpx.AsyncClient, phone: str, name: str) -> str:
    request = await client.post("/auth/otp/request", json={"phone": phone})
    assert request.status_code == 200, request.text
    response = await client.post(
        "/auth/otp/verify",
        json={"phone": phone, "otp": "123456", "name": name},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def dashboard_client() -> AsyncIterator[httpx.AsyncClient]:
    async with get_session_factory()() as session:
        await seed_data(session)

    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            yield client
    finally:
        await get_session_factory().kw["bind"].dispose()
        get_session_factory.cache_clear()


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def dashboard_data(
    dashboard_client: httpx.AsyncClient,
) -> AsyncIterator[dict[str, object]]:
    nonce = secrets.token_hex(4)
    phones = [f"7000{secrets.randbelow(1_000_000):06d}" for _ in range(2)]
    while phones[0] == phones[1]:
        phones[1] = f"7000{secrets.randbelow(1_000_000):06d}"

    tokens = [
        await _customer_token(dashboard_client, phone, f"Dashboard Customer {i}")
        for i, phone in enumerate(phones, start=1)
    ]
    admin_token = await _login(
        dashboard_client, "9000000099", "DemoAdmin!2026"
    )
    kitchen_token = await _login(
        dashboard_client, "9000000011", "KondapurKitchen!2026"
    )

    async with get_session_factory()() as session:
        outlet = await session.scalar(select(Outlet).where(Outlet.name == "Kondapur"))
        other_outlet = await session.scalar(
            select(Outlet).where(Outlet.name == "Gachibowli cloud kitchen")
        )
        users = list(
            (
                await session.scalars(
                    select(User).where(User.phone.in_(phones)).order_by(User.phone)
                )
            ).all()
        )
        users_by_phone = {user.phone: user for user in users}
        users = [users_by_phone[phone] for phone in phones]
        category = Category(
            name=f"Dashboard test {nonce}",
            sort_order=999,
            available_from=None,
            available_to=None,
        )
        session.add(category)
        await session.flush()

        items = [
            MenuItem(
                category_id=category.id,
                name=f"Dashboard suggestion {nonce}-{i}",
                description="Test item",
                photo_url="",
                is_veg=True,
                spice_level=0,
                allergens=[],
                base_price_inr=100 + i,
                active=True,
                sort_order=i,
            )
            for i in range(5)
        ]
        session.add_all(items)
        await session.flush()
        session.add_all(
            [
                OutletItemAvailability(
                    outlet_id=outlet.id, item_id=item.id, available=i < 4
                )
                for i, item in enumerate(items)
            ]
        )

        order_values = [
            (1000, 30, 20, 0, "ready_for_pickup", users[0], False),
            (2000, 40, 30, 1, "ready_for_pickup", users[0], False),
            (1500, 50, 50, 2, "ready_for_pickup", users[0], False),
            (2500, 60, 70, 3, "ready_for_pickup", users[1], True),
            (500, 30, None, 4, "cancelled", users[1], False),
        ]
        orders: list[Order] = []
        for i, (
            amount,
            promised_minutes,
            actual_minutes,
            hour,
            state,
            user,
            escalated,
        ) in enumerate(order_values):
            placed_at = datetime.combine(
                DATASET_DAY, time(10 + hour, 10), tzinfo=IST
            ).astimezone(UTC)
            order = Order(
                public_id=f"WEB-DASH-{nonce}-{i}",
                outlet_id=outlet.id,
                user_id=user.id,
                status=state,
                payment_method="upi",
                payment_status="paid",
                total_inr=amount,
                placed_at=placed_at,
                promised_at=placed_at + timedelta(minutes=promised_minutes),
                escalated_at=placed_at if escalated else None,
                cancellation_reason="customer_request" if state == "cancelled" else None,
            )
            orders.append(order)
            session.add(order)
        await session.flush()
        unpaid_placed_at = datetime.combine(
            DATASET_DAY, time(15, 10), tzinfo=IST
        ).astimezone(UTC)
        unpaid_order = Order(
            public_id=f"WEB-DASH-{nonce}-unpaid",
            outlet_id=outlet.id,
            user_id=users[0].id,
            status="ready_for_pickup",
            payment_method="upi",
            payment_status="pending",
            total_inr=9999,
            placed_at=unpaid_placed_at,
            promised_at=unpaid_placed_at + timedelta(minutes=30),
        )
        orders.append(unpaid_order)
        session.add(unpaid_order)

        # Four available items and one unavailable item are in the order history.
        session.add_all(
            [
                OrderItem(
                    order_id=orders[i % 3].id,
                    item_id=items[i].id,
                    name=items[i].name,
                    unit_price_inr=items[i].base_price_inr,
                    quantity=1,
                    addons=[],
                )
                for i in range(5)
            ]
        )
        session.add_all(
            [
                OrderStatusEvent(
                    order_id=order.id,
                    status="ready_for_pickup",
                    at=order.placed_at + timedelta(minutes=actual_minutes),
                )
                for order, (_, _, actual_minutes, _, state, _, _) in zip(
                    orders[:5], order_values, strict=True
                )
                if state == "ready_for_pickup" and actual_minutes is not None
            ]
        )
        await session.commit()

        outlet_id = outlet.id
        other_outlet_id = other_outlet.id
        user_ids = [user.id for user in users]
        order_ids = [order.id for order in orders]
        item_ids = [item.id for item in items]
        category_id = category.id

    try:
        yield {
            "admin_token": admin_token,
            "kitchen_token": kitchen_token,
            "customer_token": tokens[0],
            "outlet_id": str(outlet_id),
            "other_outlet_id": str(other_outlet_id),
            "user_ids": user_ids,
            "order_ids": order_ids,
            "item_ids": item_ids,
            "category_id": category_id,
            "from": datetime.combine(DATASET_DAY, time.min, tzinfo=IST).isoformat(),
            "to": datetime.combine(DATASET_DAY, time.max, tzinfo=IST).isoformat(),
        }
    finally:
        async with get_session_factory()() as session:
            await session.execute(delete(Order).where(Order.id.in_(order_ids)))
            await session.execute(
                delete(OutletItemAvailability).where(
                    OutletItemAvailability.item_id.in_(item_ids)
                )
            )
            await session.execute(delete(MenuItem).where(MenuItem.id.in_(item_ids)))
            await session.execute(delete(Category).where(Category.id == category_id))
            await session.execute(delete(User).where(User.id.in_(user_ids)))
            await session.commit()


@pytest.mark.asyncio(loop_scope="module")
async def test_dashboard_returns_hand_computed_metrics(
    dashboard_client: httpx.AsyncClient, dashboard_data: dict[str, object]
) -> None:
    response = await dashboard_client.get(
        "/admin/dashboard",
        params={
            "from": dashboard_data["from"],
            "to": dashboard_data["to"],
            "outlet_id": dashboard_data["outlet_id"],
        },
        headers=_auth(dashboard_data["admin_token"]),
    )
    assert response.status_code == 200, response.text
    data = response.json()

    # INR 1,000 + 2,000 + 1,500 + 2,500 + 500 = INR 7,500;
    # the average order value is INR 1,500. The pending INR 9,999 order is excluded.
    # Promises are 30, 40, 50, 60, 30 minutes: mean 42, median 40.
    # Ready times are 20, 30, 50, 70 minutes: mean 42.5, median 40;
    # 3 of 4 completed orders were on time (75%), with 1 late and 1 escalation.
    # Both customers ordered at least twice, so repeat customers are 100%.
    # One paid cancellation has reason customer_request; paid orders fill IST
    # hours 10 through 14 once each, while the pending 15:00-hour order is omitted.
    expected = {
        "orders_count": 5,
        "revenue_inr": 7500,
        "avg_order_value_inr": 1500,
        "avg_promised_minutes": 42,
        "median_promised_minutes": 40,
        "avg_actual_minutes": 42.5,
        "median_actual_minutes": 40,
        "on_time_rate": 75,
        "late_count": 1,
        "escalated_count": 1,
        "cancellations_count": 1,
        "cancellations": [{"reason": "customer_request", "count": 1}],
        "repeat_customer_pct": 100,
    }
    total = data["total"]
    outlet = next(
        row
        for row in data["outlets"]
        if row["outlet_id"] == dashboard_data["outlet_id"]
    )
    for key, value in expected.items():
        assert total[key] == value
        assert outlet[key] == value

    assert total["orders_by_hour"] == [
        {"hour": hour, "orders_count": 1 if hour in range(10, 15) else 0}
        for hour in range(24)
    ]
    assert outlet["orders_by_hour"] == total["orders_by_hour"]
    assert data["headline"] == {
        "orders": 5,
        "revenue_inr": 7500,
        "average_order_value_inr": 1500,
        "definition": "Total payable after coupon and points discounts; item prices incl. 5% GST.",
        "coupon_discount_inr": 0,
        "points_discount_inr": 0,
    }


@pytest.mark.asyncio(loop_scope="module")
async def test_dashboard_role_access_and_date_validation(
    dashboard_client: httpx.AsyncClient, dashboard_data: dict[str, object]
) -> None:
    admin = _auth(dashboard_data["admin_token"])
    kitchen = _auth(dashboard_data["kitchen_token"])
    customer = _auth(dashboard_data["customer_token"])
    own_outlet = await dashboard_client.get(
        "/kitchen/stats",
        params={"outlet_id": dashboard_data["outlet_id"]},
        headers=kitchen,
    )
    assert own_outlet.status_code == 200, own_outlet.text
    assert len(own_outlet.json()["outlets"]) == 1
    assert own_outlet.json()["outlets"][0]["outlet_id"] == dashboard_data["outlet_id"]

    forbidden_kitchen = await dashboard_client.get(
        "/kitchen/stats",
        params={"outlet_id": dashboard_data["other_outlet_id"]},
        headers=kitchen,
    )
    assert forbidden_kitchen.status_code == 403
    assert (
        await dashboard_client.get("/admin/dashboard", headers=customer)
    ).status_code == 403
    assert (
        await dashboard_client.get("/kitchen/stats", headers=customer)
    ).status_code == 403
    assert (
        await dashboard_client.get("/admin/dashboard")
    ).status_code == 401
    assert (await dashboard_client.get("/kitchen/stats")).status_code == 401

    invalid_order = await dashboard_client.get(
        "/admin/dashboard",
        params={
            "from": "2098-01-11T00:00:00+05:30",
            "to": "2098-01-10T00:00:00+05:30",
        },
        headers=admin,
    )
    too_long = await dashboard_client.get(
        "/admin/dashboard",
        params={
            "from": "2098-01-01T00:00:00+05:30",
            "to": "2098-04-01T00:00:00+05:30",
        },
        headers=admin,
    )
    assert invalid_order.status_code == 422
    assert too_long.status_code == 422


@pytest.mark.asyncio(loop_scope="module")
async def test_dashboard_empty_range_is_zero_filled(
    dashboard_client: httpx.AsyncClient, dashboard_data: dict[str, object]
) -> None:
    response = await dashboard_client.get(
        "/admin/dashboard",
        params={
            "from": "2099-01-01T00:00:00+05:30",
            "to": "2099-01-01T00:00:00+05:30",
        },
        headers=_auth(dashboard_data["admin_token"]),
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["total"]["orders_count"] == 0
    assert data["total"]["revenue_inr"] == 0
    assert data["total"]["avg_order_value_inr"] is None
    assert data["total"]["avg_promised_minutes"] is None
    assert data["total"]["median_promised_minutes"] is None
    assert data["total"]["avg_actual_minutes"] is None
    assert data["total"]["median_actual_minutes"] is None
    assert data["total"]["on_time_rate"] is None
    assert data["total"]["repeat_customer_pct"] is None
    assert data["total"]["cancellations"] == []
    assert data["total"]["orders_by_hour"] == [
        {"hour": hour, "orders_count": 0} for hour in range(24)
    ]
    for outlet in data["outlets"]:
        assert outlet["orders_count"] == 0
        assert outlet["revenue_inr"] == 0
        assert outlet["avg_order_value_inr"] is None
        assert outlet["avg_promised_minutes"] is None
        assert outlet["median_promised_minutes"] is None
        assert outlet["avg_actual_minutes"] is None
        assert outlet["median_actual_minutes"] is None
        assert outlet["on_time_rate"] is None
        assert outlet["late_count"] == 0
        assert outlet["escalated_count"] == 0
        assert outlet["cancellations_count"] == 0
        assert outlet["cancellations"] == []
        assert outlet["repeat_customer_pct"] is None
        assert outlet["orders_by_hour"] == data["total"]["orders_by_hour"]


@pytest.mark.asyncio(loop_scope="module")
async def test_order_suggestions_are_available_capped_and_read_only(
    dashboard_client: httpx.AsyncClient, dashboard_data: dict[str, object]
) -> None:
    user_ids = dashboard_data["user_ids"]
    async with get_session_factory()() as session:
        orders_before = [
            tuple(row)
            for row in (
                await session.execute(
                    select(
                        Order.id,
                        Order.outlet_id,
                        Order.user_id,
                        Order.status,
                        Order.payment_method,
                        Order.payment_status,
                        Order.total_inr,
                        Order.placed_at,
                        Order.promised_at,
                        Order.escalated_at,
                        Order.cancellation_reason,
                        Order.updated_at,
                    )
                    .where(Order.user_id == user_ids[0])
                    .order_by(Order.id)
                )
            ).all()
        ]
        order_items_before = [
            tuple(row)
            for row in (
                await session.execute(
                    select(
                        OrderItem.id,
                        OrderItem.order_id,
                        OrderItem.item_id,
                        OrderItem.unit_price_inr,
                        OrderItem.quantity,
                    )
                    .join(Order, Order.id == OrderItem.order_id)
                    .where(Order.user_id == user_ids[0])
                    .order_by(OrderItem.id)
                )
            ).all()
        ]

    response = await dashboard_client.get(
        "/orders/suggestions",
        params={"outlet_id": dashboard_data["outlet_id"]},
        headers=_auth(dashboard_data["customer_token"]),
    )
    assert response.status_code == 200, response.text
    suggestions = response.json()
    assert len(suggestions) == 3
    suggested_ids = {suggestion["item_id"] for suggestion in suggestions}
    assert str(dashboard_data["item_ids"][4]) not in suggested_ids
    assert set(suggestion["item_id"] for suggestion in suggestions).issubset(
        {str(item_id) for item_id in dashboard_data["item_ids"][:4]}
    )

    async with get_session_factory()() as session:
        orders_after = [
            tuple(row)
            for row in (
                await session.execute(
                    select(
                        Order.id,
                        Order.outlet_id,
                        Order.user_id,
                        Order.status,
                        Order.payment_method,
                        Order.payment_status,
                        Order.total_inr,
                        Order.placed_at,
                        Order.promised_at,
                        Order.escalated_at,
                        Order.cancellation_reason,
                        Order.updated_at,
                    )
                    .where(Order.user_id == user_ids[0])
                    .order_by(Order.id)
                )
            ).all()
        ]
        order_items_after = [
            tuple(row)
            for row in (
                await session.execute(
                    select(
                        OrderItem.id,
                        OrderItem.order_id,
                        OrderItem.item_id,
                        OrderItem.unit_price_inr,
                        OrderItem.quantity,
                    )
                    .join(Order, Order.id == OrderItem.order_id)
                    .where(Order.user_id == user_ids[0])
                    .order_by(OrderItem.id)
                )
            ).all()
        ]
    assert orders_after == orders_before
    assert order_items_after == order_items_before
