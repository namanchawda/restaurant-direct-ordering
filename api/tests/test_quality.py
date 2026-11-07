"""Quality and safety regression tests for Step 9 (DB-backed).

Fast: one API client per module, per-customer cleanup in finalizers.
Run from ``api``:  .\\.venv\\Scripts\\python -m pytest tests\\test_quality.py
"""

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from app.db.session import get_session_factory
from app.main import app
from app.models import (
    MenuItem,
    Order,
    OrderItem,
    Outlet,
    OutletItemAvailability,
    User,
)
from app.seed import seed_data

from conftest import delete_customer_data

PHONE_PREFIX = "7000"


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def api_client() -> AsyncIterator[httpx.AsyncClient]:
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


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _phone() -> str:
    suffix = int(datetime.now(UTC).timestamp() * 1000) % 100_000_000
    return f"{PHONE_PREFIX}{suffix:08d}"


async def _register_customer(api_client: httpx.AsyncClient) -> dict[str, str]:
    phone = _phone()
    await api_client.post("/auth/otp/request", json={"phone": phone})
    response = await api_client.post(
        "/auth/otp/verify", json={"phone": phone, "otp": "123456"}
    )
    assert response.status_code == 200, response.text
    return {"phone": phone, "token": response.json()["access_token"]}


async def _delete_customer_data(phone: str) -> None:
    await delete_customer_data(phone)


@pytest_asyncio.fixture(loop_scope="module")
async def customer(api_client: httpx.AsyncClient) -> AsyncIterator[dict[str, str]]:
    value = await _register_customer(api_client)
    try:
        yield value
    finally:
        await _delete_customer_data(value["phone"])


@pytest_asyncio.fixture(loop_scope="module")
async def other_customer(api_client: httpx.AsyncClient) -> AsyncIterator[dict[str, str]]:
    value = await _register_customer(api_client)
    try:
        yield value
    finally:
        await _delete_customer_data(value["phone"])


async def _outlet(name: str) -> Outlet:
    async with get_session_factory()() as session:
        return await session.scalar(select(Outlet).where(Outlet.name == name))


async def _kitchen_token(api_client: httpx.AsyncClient, phone: str, password: str) -> str:
    response = await api_client.post(
        "/auth/login", json={"phone": phone, "password": password}
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


async def _available_items(outlet_id) -> list[MenuItem]:
    async with get_session_factory()() as session:
        rows = (
            await session.execute(
                select(MenuItem)
                .join(
                    OutletItemAvailability,
                    (OutletItemAvailability.item_id == MenuItem.id)
                    & (OutletItemAvailability.outlet_id == outlet_id)
                    & OutletItemAvailability.available.is_(True),
                )
                .where(MenuItem.active.is_(True))
            )
        )
        return list(rows.scalars().all())


async def _create_paid_order(
    session,
    *,
    outlet: Outlet,
    user_id,
    public_id: str,
    item: MenuItem,
    ordered_at: datetime,
) -> Order:
    order = Order(
        public_id=public_id,
        outlet_id=outlet.id,
        user_id=user_id,
        status="delivered",
        payment_method="card",
        payment_status="paid",
        total_inr=item.base_price_inr,
        delivery_address="Test address, Hyderabad",
        placed_at=ordered_at,
        promised_at=ordered_at + timedelta(minutes=30),
    )
    order.items.append(
        OrderItem(
            item_id=item.id,
            name=item.name,
            unit_price_inr=item.base_price_inr,
            quantity=1,
        )
    )
    session.add(order)
    return order


@pytest.mark.asyncio(loop_scope="module")
async def test_suggestions_require_auth_and_reject_kitchen_role(
    api_client: httpx.AsyncClient,
) -> None:
    outlet = await _outlet("Kondapur")
    unauthenticated = await api_client.get(
        f"/orders/suggestions?outlet_id={outlet.id}"
    )
    assert unauthenticated.status_code == 401
    kitchen_token = await _kitchen_token(
        api_client, "9000000011", "KondapurKitchen!2026"
    )
    forbidden = await api_client.get(
        f"/orders/suggestions?outlet_id={outlet.id}", headers=_auth(kitchen_token)
    )
    assert forbidden.status_code == 403


@pytest.mark.asyncio(loop_scope="module")
async def test_suggestions_rank_by_frequency_then_recency(
    api_client: httpx.AsyncClient,
) -> None:
    outlet = await _outlet("Kondapur")
    items = (await _available_items(outlet.id))[:3]
    if len(items) < 3:
        pytest.skip("Seed does not expose three available items at this outlet.")
    # Ranking checks need a customer with clean history, kept out of the module fixture.
    value = await _register_customer(api_client)
    try:
        async with get_session_factory()() as session:
            user = await session.scalar(select(User).where(User.phone == value["phone"]))
            assert user is not None
            now = datetime.now(UTC).replace(second=0, microsecond=0)
            plan = [
                (items[0], now - timedelta(days=8)),
                (items[0], now - timedelta(days=3)),
                (items[0], now - timedelta(days=1, minutes=30)),
                (items[1], now - timedelta(days=5)),
                (items[1], now - timedelta(days=2, minutes=30)),
                (items[2], now - timedelta(days=8)),
                (items[2], now - timedelta(days=2, minutes=10)),
            ]
            public_ids = []
            for order_index, (menu_item, ordered_at) in enumerate(plan):
                public_ids.append(f"QTEST-SUG-{order_index:02d}")
                await _create_paid_order(
                    session,
                    outlet=outlet,
                    user_id=user.id,
                    public_id=public_ids[-1],
                    item=menu_item,
                    ordered_at=ordered_at,
                )
            await session.commit()

        response = await api_client.get(
            f"/orders/suggestions?outlet_id={outlet.id}", headers=_auth(value["token"])
        )
        assert response.status_code == 200, response.text
        ranked_ids = [row["item_id"] for row in response.json()]
        # items[0] appears 3x (highest frequency wins). items[1] and items[2] both
        # appear 2x; recency decides so items[2] (updated most recently) is first.
        assert ranked_ids[0] == str(items[0].id), ranked_ids
        assert ranked_ids[1] == str(items[2].id), ranked_ids
        assert ranked_ids[2] == str(items[1].id), ranked_ids
    finally:
        async with get_session_factory()() as session:
            await session.execute(
                delete(Order).where(Order.public_id.like("QTEST-SUG-%"))
            )
            await session.commit()
        await _delete_customer_data(value["phone"])


@pytest.mark.asyncio(loop_scope="module")
async def test_cross_outlet_and_cross_customer_isolation(
    api_client: httpx.AsyncClient,
    customer: dict[str, str],
    other_customer: dict[str, str],
) -> None:
    kondapur = await _outlet("Kondapur")
    items = (await _available_items(kondapur.id))[:1]
    assert items, "Seed must expose at least one available item at Kondapur."

    # A paid order belonging to the other customer at Kondapur.
    async with get_session_factory()() as session:
        other_user = await session.scalar(
            select(User).where(User.phone == other_customer["phone"])
        )
        assert other_user is not None
        now = datetime.now(UTC)
        order = await _create_paid_order(
            session,
            outlet=kondapur,
            user_id=other_user.id,
            public_id="QTEST-ISO-01",
            item=items[0],
            ordered_at=now,
        )
        await session.commit()

    try:
        # The owner can see it; another customer gets 404 everywhere.
        own_view = await api_client.get(
            "/orders/QTEST-ISO-01", headers=_auth(other_customer["token"])
        )
        assert own_view.status_code == 200, own_view.text
        foreign_view = await api_client.get(
            "/orders/QTEST-ISO-01", headers=_auth(customer["token"])
        )
        assert foreign_view.status_code == 404
        foreign_pay = await api_client.post(
            "/orders/QTEST-ISO-01/pay",
            json={"upi_id": "stranger@okhdfcbank"},
            headers=_auth(customer["token"]),
        )
        assert foreign_pay.status_code == 404
        foreign_stream = await api_client.post(
            "/orders/QTEST-ISO-01/stream-token",
            headers=_auth(customer["token"]),
        )
        assert foreign_stream.status_code == 404

        kitchen_b = await _kitchen_token(
            api_client, "9000000013", "KukatpallyKitchen!2026"
        )
        page = await api_client.get("/kitchen/orders", headers=_auth(kitchen_b))
        assert page.status_code == 200, page.text
        public_ids = {row["public_id"] for row in page.json()}
        assert "QTEST-ISO-01" not in public_ids
        cross_stats = await api_client.get(
            f"/kitchen/stats?outlet_id={kondapur.id}", headers=_auth(kitchen_b)
        )
        assert cross_stats.status_code == 403
        cross_patch = await api_client.patch(
            "/kitchen/orders/QTEST-ISO-01/status",
            json={"status": "accepted"},
            headers=_auth(kitchen_b),
        )
        assert cross_patch.status_code == 404
        cross_availability = await api_client.patch(
            f"/kitchen/outlets/{kondapur.id}/items/{items[0].id}/availability",
            json={"available": False},
            headers=_auth(kitchen_b),
        )
        assert cross_availability.status_code == 403
        # The cross-outlet kitchen cannot mint a stream token for Kondapur at all;
        # minted tokens are scoped to own channel, so a Kukatpally token never
        # reaches Kondapur's SSE feed.
        own_stream = await api_client.post(
            "/kitchen/stream-token", headers=_auth(kitchen_b)
        )
        assert own_stream.status_code == 200
    finally:
        async with get_session_factory()() as session:
            await session.execute(delete(Order).where(Order.public_id == "QTEST-ISO-01"))
            await session.commit()


@pytest.mark.asyncio(loop_scope="module")
async def test_client_sent_prices_are_ignored_and_gst_matches(
    api_client: httpx.AsyncClient, customer: dict[str, str]
) -> None:
    outlet = await _outlet("Kondapur")
    menu = await api_client.get(f"/outlets/{outlet.id}/menu")
    assert menu.status_code == 200, menu.text
    biryani = next(
        row
        for category in menu.json()["categories"]
        for row in category["items"]
        if row["name"] == "Chicken dum biryani" and row["available"]
    )
    unit_price = biryani["price"]
    response = await api_client.post(
        "/orders",
        json={
            "outlet_id": str(outlet.id),
            "items": [
                {
                    "item_id": biryani["id"],
                    "quantity": 2,
                    "price": 1,
                    "price_inr": 999999,
                }
            ],
            "payment_method": "card",
            "delivery_address": {
                "address": "Test address, Hyderabad",
                "lat": outlet.lat,
                "lng": outlet.lng,
            },
            "phone": customer["phone"],
        },
        headers=_auth(customer["token"]),
    )
    assert response.status_code == 201, response.text
    order = response.json()
    expected_total = unit_price * 2
    assert order["total_inr"] == expected_total
    assert order["gst_included_inr"] == round(expected_total * 5 / 105)
    async with get_session_factory()() as session:
        await session.execute(
            delete(Order).where(Order.public_id == order["public_id"])
        )
        await session.commit()


@pytest.mark.asyncio(loop_scope="module")
async def test_payment_retry_updates_method_and_creates_no_second_order(
    api_client: httpx.AsyncClient, customer: dict[str, str]
) -> None:
    outlet = await _outlet("Kondapur")
    menu = await api_client.get(f"/outlets/{outlet.id}/menu")
    biryani = next(
        row
        for category in menu.json()["categories"]
        for row in category["items"]
        if row["name"] == "Chicken dum biryani" and row["available"]
    )
    created = await api_client.post(
        "/orders",
        json={
            "outlet_id": str(outlet.id),
            "items": [{"item_id": biryani["id"], "quantity": 1}],
            "payment_method": "card",
            "delivery_address": {
                "address": "Test address, Hyderabad",
                "lat": outlet.lat,
                "lng": outlet.lng,
            },
            "phone": customer["phone"],
        },
        headers=_auth(customer["token"]),
    )
    assert created.status_code == 201, created.text
    public_id = created.json()["public_id"]

    card_failed = await api_client.post(
        f"/orders/{public_id}/pay",
        json={"card_number": "4000000000000002"},
        headers=_auth(customer["token"]),
    )
    assert card_failed.json()["payment_status"] == "failed"
    retried_upi = await api_client.post(
        f"/orders/{public_id}/pay",
        json={"upi_id": "customer@okhdfcbank"},
        headers=_auth(customer["token"]),
    )
    assert retried_upi.status_code == 200, retried_upi.text
    assert retried_upi.json()["payment_status"] == "paid"

    detail = await api_client.get(f"/orders/{public_id}", headers=_auth(customer["token"]))
    assert detail.json()["payment_method"] == "upi"
    history = await api_client.get("/orders/mine", headers=_auth(customer["token"]))
    assert [row["public_id"] for row in history.json()] == [public_id]
