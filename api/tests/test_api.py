from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
import secrets

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from app.main import app
from app.db.session import get_session_factory
from app.models import Addon, CityPrice, ItemAddon, ItemVariant, MenuItem, Order, Outlet, User
from app.seed import seed_data
from app.services import events
from app.services.escalation import run_escalation_once


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


@pytest_asyncio.fixture(loop_scope="module")
async def customer(api_client: httpx.AsyncClient) -> AsyncIterator[dict[str, str]]:
    phone = f"8{secrets.randbelow(900_000_000) + 100_000_000}"
    await api_client.post("/auth/otp/request", json={"phone": phone})
    response = await api_client.post(
        "/auth/otp/verify",
        json={"phone": phone, "otp": "123456", "name": "API Test Customer"},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    value = {"phone": phone, "token": data["access_token"]}
    try:
        yield value
    finally:
        async with get_session_factory()() as session:
            user = await session.scalar(select(User).where(User.phone == phone))
            if user is not None:
                await session.execute(delete(Order).where(Order.user_id == user.id))
                await session.delete(user)
                await session.commit()


async def _login(client: httpx.AsyncClient, phone: str, password: str) -> str:
    response = await client.post(
        "/auth/login", json={"phone": phone, "password": password}
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


async def _outlet(name: str) -> Outlet:
    async with get_session_factory()() as session:
        return await session.scalar(select(Outlet).where(Outlet.name == name))


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _create_order(
    client: httpx.AsyncClient,
    customer: dict[str, str],
    *,
    payment_method: str = "upi",
    outside_radius: bool = False,
) -> httpx.Response:
    outlet = await _outlet("Kondapur")
    async with get_session_factory()() as session:
        item = await session.scalar(select(MenuItem).where(MenuItem.name == "Chicken dum biryani"))
        variant = await session.scalar(
            select(ItemVariant).where(
                ItemVariant.item_id == item.id,
                ItemVariant.name == "Family pack",
            )
        )
        raita = await session.scalar(
            select(Addon)
            .join(ItemAddon, ItemAddon.addon_id == Addon.id)
            .where(ItemAddon.item_id == item.id, Addon.name == "Raita")
        )
        delivery_lat = 0 if outside_radius else outlet.lat
        delivery_lng = 0 if outside_radius else outlet.lng
    body = {
        "outlet_id": str(outlet.id),
        "items": [
            {
                "item_id": str(item.id),
                "variant_id": str(variant.id),
                "addon_ids": [str(raita.id)],
                "quantity": 1,
                "price": 1,
                "price_inr": 1,
            }
        ],
        "payment_method": payment_method,
        "delivery_address": {
            "address": "Test address, Hyderabad",
            "lat": delivery_lat,
            "lng": delivery_lng,
        },
        "phone": customer["phone"],
    }
    return await client.post("/orders", json=body, headers=_auth(customer["token"]))


@pytest.mark.asyncio(loop_scope="module")
async def test_authentication_roles_and_outlet_isolation(
    api_client: httpx.AsyncClient, customer: dict[str, str]
) -> None:
    customer_me = await api_client.get("/auth/me", headers=_auth(customer["token"]))
    assert customer_me.status_code == 200
    assert customer_me.json()["role"] == "customer"
    assert customer_me.json()["marketing_opt_in"] is False
    opted_in = await api_client.post(
        "/auth/otp/verify",
        json={
            "phone": customer["phone"],
            "otp": "123456",
            "marketing_opt_in": True,
        },
    )
    assert opted_in.json()["user"]["marketing_opt_in"] is True

    kitchen_token = await _login(api_client, "9000000011", "KondapurKitchen!2026")
    kitchen_me = await api_client.get("/auth/me", headers=_auth(kitchen_token))
    assert kitchen_me.json()["role"] == "kitchen"
    admin_token = await _login(api_client, "9000000099", "DemoAdmin!2026")
    admin_me = await api_client.get("/auth/me", headers=_auth(admin_token))
    assert admin_me.json()["role"] == "admin"

    forbidden = await api_client.get("/admin/categories", headers=_auth(customer["token"]))
    assert forbidden.status_code == 403
    unauthenticated = await api_client.get("/auth/me")
    assert unauthenticated.status_code == 401

    kukatpally_order = await api_client.get(
        "/orders/WEB-778146", headers=_auth(customer["token"])
    )
    # A newly registered customer cannot read another customer's order.
    assert kukatpally_order.status_code == 404
    kitchen_orders = await api_client.get("/kitchen/orders", headers=_auth(kitchen_token))
    assert kitchen_orders.status_code == 200
    kondapur_id = str((await _outlet("Kondapur")).id)
    assert all(row["outlet_id"] == kondapur_id for row in kitchen_orders.json())
    assert "WEB-778146" not in {row["public_id"] for row in kitchen_orders.json()}


@pytest.mark.asyncio(loop_scope="module")
async def test_admin_cms_and_otp_rate_limit(api_client: httpx.AsyncClient) -> None:
    admin_token = await _login(api_client, "9000000099", "DemoAdmin!2026")
    items = await api_client.get("/admin/items", headers=_auth(admin_token))
    assert items.status_code == 200, items.text
    item_id = items.json()[0]["id"]
    availability = await api_client.get(
        f"/admin/items/{item_id}/availability", headers=_auth(admin_token)
    )
    assert availability.status_code == 200, availability.text
    assert {row["name"] for row in availability.json()} >= {
        "Kondapur",
        "Gachibowli cloud kitchen",
        "Kukatpally",
    }
    assert all(isinstance(row["available"], bool) for row in availability.json())
    updated_item = await api_client.patch(
        f"/admin/items/{item_id}",
        json={
            "base_price_inr": items.json()[0]["base_price_inr"],
            "variants": items.json()[0]["variants"],
            "addon_ids": items.json()[0]["addon_ids"],
        },
        headers=_auth(admin_token),
    )
    assert updated_item.status_code == 200, updated_item.text

    suffix = secrets.token_hex(4)
    created = await api_client.post(
        "/admin/categories",
        json={"name": f"API test category {suffix}", "sort_order": 99},
        headers=_auth(admin_token),
    )
    assert created.status_code == 201, created.text
    category_id = created.json()["id"]
    updated = await api_client.patch(
        f"/admin/categories/{category_id}",
        json={"sort_order": 100},
        headers=_auth(admin_token),
    )
    assert updated.json()["sort_order"] == 100
    deleted = await api_client.delete(
        f"/admin/categories/{category_id}", headers=_auth(admin_token)
    )
    assert deleted.status_code == 204

    limited_phone = f"79{secrets.randbelow(90_000_000) + 10_000_000}"
    statuses = [
        (
            await api_client.post(
                "/auth/otp/request", json={"phone": limited_phone}
            )
        ).status_code
        for _ in range(6)
    ]
    assert statuses == [200, 200, 200, 200, 200, 429]


@pytest.mark.asyncio(loop_scope="module")
async def test_menu_availability_time_window_and_city_price(
    api_client: httpx.AsyncClient,
) -> None:
    outlet = await _outlet("Kondapur")
    response = await api_client.get(f"/outlets/{outlet.id}/menu")
    assert response.status_code == 200, response.text
    menu = response.json()
    assert menu["price_note"] == "incl. 5% GST"
    gobi = next(
        item
        for category in menu["categories"]
        for item in category["items"]
        if item["name"] == "Gobi 65"
    )
    assert gobi["available"] is False
    haleem = next(category for category in menu["categories"] if category["name"] == "Haleem")
    assert isinstance(haleem["available_now"], bool)
    assert "Asia/Kolkata" in haleem["window_text"]

    async with get_session_factory()() as session:
        item = await session.scalar(select(MenuItem).where(MenuItem.name == "Chicken dum biryani"))
        city_price = await session.scalar(
            select(CityPrice).where(
                CityPrice.item_id == item.id, CityPrice.city == outlet.city
            )
        )
        original_price = city_price.price_inr
        city_price.price_inr = original_price + 17
        await session.commit()
    try:
        response = await api_client.get(f"/outlets/{outlet.id}/menu")
        biryani = next(
            item
            for category in response.json()["categories"]
            for item in category["items"]
            if item["name"] == "Chicken dum biryani"
        )
        assert biryani["price"] == original_price + 17
    finally:
        async with get_session_factory()() as session:
            price = await session.scalar(
                select(CityPrice).where(
                    CityPrice.item_id == item.id, CityPrice.city == outlet.city
                )
            )
            price.price_inr = original_price
            await session.commit()


@pytest.mark.asyncio(loop_scope="module")
async def test_server_pricing_payment_and_out_of_radius(
    api_client: httpx.AsyncClient, customer: dict[str, str]
) -> None:
    created = await _create_order(api_client, customer)
    assert created.status_code == 201, created.text
    order = created.json()
    assert order["total_inr"] == 1030
    assert order["gst_included_inr"] == round(1030 * 5 / 105)
    assert order["promised_at"]
    public_id = order["public_id"]

    hidden_before_payment = await api_client.get(
        "/kitchen/orders",
        headers=_auth(await _login(api_client, "9000000011", "KondapurKitchen!2026")),
    )
    assert public_id not in {row["public_id"] for row in hidden_before_payment.json()}
    failed = await api_client.post(
        f"/orders/{public_id}/pay",
        json={"upi_id": "customer@fail"},
        headers=_auth(customer["token"]),
    )
    assert failed.json()["payment_status"] == "failed"
    succeeded = await api_client.post(
        f"/orders/{public_id}/pay",
        json={"upi_id": "customer@ok"},
        headers=_auth(customer["token"]),
    )
    assert succeeded.json()["payment_status"] == "paid"

    outside = await _create_order(api_client, customer, outside_radius=True)
    assert outside.status_code == 422

    card_order = await _create_order(api_client, customer, payment_method="card")
    assert card_order.status_code == 201, card_order.text
    card_failure = await api_client.post(
        f"/orders/{card_order.json()['public_id']}/pay",
        json={"card_number": "4000000000000002"},
        headers=_auth(customer["token"]),
    )
    assert card_failure.json()["payment_status"] == "failed"
    switched = await api_client.post(
        f"/orders/{card_order.json()['public_id']}/pay",
        json={"upi_id": "customer@ok"},
        headers=_auth(customer["token"]),
    )
    assert switched.status_code == 200, switched.text
    assert switched.json()["payment_status"] == "paid"
    switched_detail = await api_client.get(
        f"/orders/{card_order.json()['public_id']}",
        headers=_auth(customer["token"]),
    )
    assert switched_detail.json()["payment_method"] == "upi"


@pytest.mark.asyncio(loop_scope="module")
async def test_kitchen_transitions_override_and_late_order(
    api_client: httpx.AsyncClient, customer: dict[str, str]
) -> None:
    created = await _create_order(api_client, customer)
    assert created.status_code == 201, created.text
    order = created.json()
    public_id = order["public_id"]
    await api_client.post(
        f"/orders/{public_id}/pay",
        json={"upi_id": "customer@ok"},
        headers=_auth(customer["token"]),
    )

    kitchen_token = await _login(api_client, "9000000011", "KondapurKitchen!2026")
    visible = await api_client.get("/kitchen/orders", headers=_auth(kitchen_token))
    assert public_id in {row["public_id"] for row in visible.json()}

    invalid = await api_client.patch(
        f"/kitchen/orders/{public_id}/status",
        json={"status": "preparing"},
        headers=_auth(kitchen_token),
    )
    assert invalid.status_code == 409
    wrong_kitchen = await _login(api_client, "9000000013", "KukatpallyKitchen!2026")
    isolated = await api_client.patch(
        f"/kitchen/orders/{public_id}/status",
        json={"status": "accepted"},
        headers=_auth(wrong_kitchen),
    )
    assert isolated.status_code == 404

    accepted = await api_client.patch(
        f"/kitchen/orders/{public_id}/status",
        json={"status": "accepted"},
        headers=_auth(kitchen_token),
    )
    assert accepted.status_code == 200, accepted.text
    before_override = datetime.fromisoformat(accepted.json()["promised_at"])
    overridden = await api_client.patch(
        f"/kitchen/orders/{public_id}/override",
        json={"minutes": 42},
        headers=_auth(kitchen_token),
    )
    after_override = datetime.fromisoformat(overridden.json()["promised_at"])
    placed = datetime.fromisoformat(overridden.json()["placed_at"])
    assert after_override != before_override
    assert round((after_override - placed).total_seconds() / 60) == 42

    await api_client.post("/auth/otp/request", json={"phone": "9000000001"})
    demo_customer = await api_client.post(
        "/auth/otp/verify",
        json={"phone": "9000000001", "otp": "123456"},
    )
    late = await api_client.get(
        "/orders/WEB-778146",
        headers=_auth(demo_customer.json()["access_token"]),
    )
    assert late.status_code == 200
    assert late.json()["is_late"] is True
    assert late.json()["minutes_late"] >= 4

@pytest.mark.asyncio(loop_scope="module")
async def test_live_stream_tokens_kitchen_items_and_escalation(
    api_client: httpx.AsyncClient, customer: dict[str, str]
) -> None:
    kitchen_token = await _login(api_client, "9000000011", "KondapurKitchen!2026")
    outlet = await _outlet("Kondapur")

    created = await _create_order(api_client, customer)
    assert created.status_code == 201, created.text
    public_id = created.json()["public_id"]

    before_pay = events.latest_event_id(events.outlet_channel(outlet.id))
    paid = await api_client.post(
        f"/orders/{public_id}/pay",
        json={"upi_id": "customer@ok"},
        headers=_auth(customer["token"]),
    )
    assert paid.status_code == 200, paid.text
    after_pay = events.latest_event_id(events.outlet_channel(outlet.id))
    assert after_pay is not None
    assert before_pay is None or after_pay > before_pay

    items = await api_client.get("/kitchen/items", headers=_auth(kitchen_token))
    assert items.status_code == 200, items.text
    assert any(
        row["name"] == "Chicken dum biryani" and row["available"] is True
        for row in items.json()
    )

    kitchen_stream = await api_client.post(
        "/kitchen/stream-token", headers=_auth(kitchen_token)
    )
    assert kitchen_stream.status_code == 200, kitchen_stream.text
    kitchen_stream_token = kitchen_stream.json()["token"]
    assert kitchen_stream.json()["channel"] == events.outlet_channel(outlet.id)

    order_stream = await api_client.post(
        f"/orders/{public_id}/stream-token", headers=_auth(customer["token"])
    )
    assert order_stream.status_code == 200, order_stream.text
    order_stream_token = order_stream.json()["token"]

    wrong_scope = await api_client.get(
        f"/kitchen/stream?token={order_stream_token}"
    )
    assert wrong_scope.status_code == 401
    access_token_in_query = await api_client.get(
        f"/kitchen/stream?token={customer['token']}"
    )
    assert access_token_in_query.status_code == 401
    order_wrong_scope = await api_client.get(
        f"/orders/{public_id}/stream?token={kitchen_stream_token}"
    )
    assert order_wrong_scope.status_code == 401

    async with get_session_factory()() as session:
        order = await session.scalar(select(Order).where(Order.public_id == public_id))
        order.promised_at = datetime.now(UTC) - timedelta(minutes=15)
        await session.commit()
        escalated = await run_escalation_once(
            session, escalation_minutes=10, extend_minutes=7
        )
    assert public_id in {order.public_id for order in escalated}

    async with get_session_factory()() as session:
        order = await session.scalar(select(Order).where(Order.public_id == public_id))
        assert order.escalated_at is not None
        assert order.escalation_acknowledged_at is None
        assert order.promised_at > datetime.now(UTC)

    kitchen_orders = await api_client.get(
        "/kitchen/orders", headers=_auth(kitchen_token)
    )
    row = next(
        order for order in kitchen_orders.json() if order["public_id"] == public_id
    )
    assert row["is_escalated"] is True
    assert row["customer_first_name"] == "API"

    acknowledged = await api_client.post(
        f"/kitchen/orders/{public_id}/acknowledge-escalation",
        headers=_auth(kitchen_token),
    )
    assert acknowledged.status_code == 200, acknowledged.text
    assert acknowledged.json()["is_escalated"] is False

    async with get_session_factory()() as session:
        again = await run_escalation_once(session)
    assert public_id not in {order.public_id for order in again}

    stats = await api_client.get("/kitchen/stream/stats", headers=_auth(kitchen_token))
    assert stats.status_code == 200
    assert "subscribers" in stats.json()
