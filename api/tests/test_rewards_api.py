"""Reward and coupon flows that need the database and API: redemption races, delivery crediting, coupon limits, role checks."""

import asyncio
from collections.abc import AsyncIterator
import secrets

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from app.main import app
from app.db.session import get_session_factory
from app.models import (
    Addon,
    Coupon,
    CouponRedemption,
    ItemAddon,
    ItemVariant,
    LoyaltyTransaction,
    MenuItem,
    Order,
    Outlet,
    User,
)
from app.seed import seed_data
from app.services.rewards import get_or_create_account

ADMIN_LOGIN = {"phone": "9000000099", "password": "DemoAdmin!2026"}
KONDAPUR_KITCHEN_LOGIN = {"phone": "9000000011", "password": "KondapurKitchen!2026"}


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


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def cart():
    async with get_session_factory()() as session:
        outlet = await session.scalar(select(Outlet).where(Outlet.name == "Kondapur"))
        item = await session.scalar(select(MenuItem).where(MenuItem.name == "Chicken dum biryani"))
        variant = await session.scalar(
            select(ItemVariant).where(
                ItemVariant.item_id == item.id, ItemVariant.name == "Family pack"
            )
        )
        raita = await session.scalar(
            select(Addon)
            .join(ItemAddon, ItemAddon.addon_id == Addon.id)
            .where(ItemAddon.item_id == item.id, Addon.name == "Raita")
        )
    line = {
        "item_id": str(item.id),
        "variant_id": str(variant.id),
        "addon_ids": [str(raita.id)],
        "quantity": 1,
    }
    return {"outlet_id": str(outlet.id), "line": line}


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def small_cart():
    """Sub-Rs500 cart: Veg biryani Full (Rs 250) + Raita addon (Rs 50) = Rs 300 subtotal."""
    async with get_session_factory()() as session:
        outlet = await session.scalar(select(Outlet).where(Outlet.name == "Kondapur"))
        item = await session.scalar(select(MenuItem).where(MenuItem.name == "Veg biryani"))
        variant = await session.scalar(
            select(ItemVariant).where(
                ItemVariant.item_id == item.id, ItemVariant.name == "Full"
            )
        )
        raita = await session.scalar(
            select(Addon)
            .join(ItemAddon, ItemAddon.addon_id == Addon.id)
            .where(ItemAddon.item_id == item.id, Addon.name == "Raita")
        )
    line = {
        "item_id": str(item.id),
        "variant_id": str(variant.id),
        "addon_ids": [str(raita.id)],
        "quantity": 1,
    }
    return {"outlet_id": str(outlet.id), "line": line}


@pytest_asyncio.fixture(loop_scope="module")
async def register_customer(api_client: httpx.AsyncClient) -> AsyncIterator:
    """Register throwaway customers; every phone uses the 7000 test prefix."""
    phones: list[str] = []
    codes: list[str] = []

    async def register(coupon_code: str | None = None) -> dict[str, str]:
        if coupon_code:
            codes.append(coupon_code)
        phone = f"7000{secrets.randbelow(10_000_000):07d}"
        await api_client.post("/auth/otp/request", json={"phone": phone})
        response = await api_client.post(
            "/auth/otp/verify",
            json={"phone": phone, "otp": "123456", "name": "Rewards Test Customer"},
        )
        assert response.status_code == 200, response.text
        phones.append(phone)
        return {"phone": phone, "token": response.json()["access_token"]}

    try:
        yield register
    finally:
        async with get_session_factory()() as session:
            for phone in phones:
                user = await session.scalar(select(User).where(User.phone == phone))
                if user is not None:
                    # Loyalty rows and coupon redemptions must go first: their FKs
                    # are NOT NULL, and deleting the user directly would make the
                    # ORM emit UPDATE ... SET user_id = NULL, violating the column.
                    await session.execute(
                        delete(LoyaltyTransaction).where(LoyaltyTransaction.user_id == user.id)
                    )
                    await session.execute(
                        delete(CouponRedemption).where(CouponRedemption.user_id == user.id)
                    )
                    await session.execute(delete(Order).where(Order.user_id == user.id))
                    await session.delete(user)
            if codes:
                created = (
                    await session.scalars(select(Coupon).where(Coupon.code.in_(codes)))
                ).all()
                for coupon in created:
                    await session.delete(coupon)
            await session.commit()


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _error(response: httpx.Response) -> str:
    """Read the API error envelope: {"error": {"code", "message", ["details"]}}."""
    return response.json()["error"]["message"]


def _order_body(
    cart: dict[str, object],
    customer: dict[str, str],
    *,
    coupon_code: str | None = None,
    redeem_points: int = 0,
) -> dict[str, object]:
    body: dict[str, object] = {
        "outlet_id": cart["outlet_id"],
        "items": [cart["line"]],
        "payment_method": "upi",
        "delivery_address": {
            "address": "Test address, Hyderabad",
            "lat": 17.4574,
            "lng": 78.3819,
        },
        "phone": customer["phone"],
        "redeem_points": redeem_points,
    }
    if coupon_code:
        body["coupon_code"] = coupon_code
    return body


async def _pay(api_client: httpx.AsyncClient, customer: dict[str, str], public_id: str) -> None:
    response = await api_client.post(
        f"/orders/{public_id}/pay",
        json={"upi_id": "customer@ok"},
        headers=_auth(customer["token"]),
    )
    assert response.status_code == 200, response.text
    assert response.json()["payment_status"] == "paid"


async def _kitchen_drive(
    api_client: httpx.AsyncClient,
    kitchen_token: str,
    public_id: str,
    status: str,
    reason: str | None = None,
) -> httpx.Response:
    body: dict[str, str] = {"status": status}
    if reason is not None:
        body["reason"] = reason
    return await api_client.patch(
        f"/kitchen/orders/{public_id}/status",
        json=body,
        headers=_auth(kitchen_token),
    )


async def _set_balance(phone: str, balance: int) -> None:
    async with get_session_factory()() as session:
        user = await session.scalar(select(User).where(User.phone == phone))
        assert user is not None
        account = await get_or_create_account(session, user.id)
        account.balance_points = balance
        account.lifetime_points = max(account.lifetime_points or 0, balance)
        await session.commit()


async def _balance_for(phone: str) -> int:
    async with get_session_factory()() as session:
        user = await session.scalar(select(User).where(User.phone == phone))
        assert user is not None
        account = await get_or_create_account(session, user.id)
        return account.balance_points


async def _admin_token(api_client: httpx.AsyncClient) -> str:
    response = await api_client.post("/auth/login", json=ADMIN_LOGIN)
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


@pytest.mark.asyncio(loop_scope="module")
async def test_redeem_more_than_balance_rejected(
    api_client: httpx.AsyncClient, cart, register_customer
) -> None:
    customer = await register_customer()
    response = await api_client.post(
        "/orders",
        json=_order_body(cart, customer, redeem_points=200),
        headers=_auth(customer["token"]),
    )
    assert response.status_code == 422, response.text
    assert "At least 200 points" in _error(response)

    await _set_balance(customer["phone"], 250)
    response = await api_client.post(
        "/orders",
        json=_order_body(cart, customer, redeem_points=300),
        headers=_auth(customer["token"]),
    )
    assert response.status_code == 422, response.text
    assert _error(response) == "You do not have enough points."

    response = await api_client.post(
        "/orders",
        json=_order_body(cart, customer, redeem_points=200),
        headers=_auth(customer["token"]),
    )
    assert response.status_code == 201, response.text
    order = response.json()
    assert order["total_inr"] == 930
    assert order["points_discount_inr"] == 100
    assert order["redeemed_points"] == 200
    assert await _balance_for(customer["phone"]) == 50


@pytest.mark.asyncio(loop_scope="module")
async def test_two_simultaneous_orders_cannot_overspend_points(
    api_client: httpx.AsyncClient, cart, register_customer
) -> None:
    customer = await register_customer()
    await _set_balance(customer["phone"], 500)
    responses = await asyncio.gather(
        *[
            api_client.post(
                "/orders",
                json=_order_body(cart, customer, redeem_points=400),
                headers=_auth(customer["token"]),
            )
            for _ in range(2)
        ]
    )
    statuses = sorted(response.status_code for response in responses)
    assert statuses == [201, 422]
    redeemed = []
    for response in responses:
        if response.status_code == 201:
            redeemed.append(response.json()["redeemed_points"])
        else:
            assert "points" in _error(response), response.text
    async with get_session_factory()() as session:
        user = await session.scalar(select(User).where(User.phone == customer["phone"]))
        spent = await session.scalar(
            select(func.sum(Order.redeemed_points)).where(Order.user_id == user.id)
        )
    assert int(spent or 0) == sum(redeemed)
    assert int(spent or 0) <= 500
    assert await _balance_for(customer["phone"]) == 500 - int(spent or 0)


@pytest.mark.asyncio(loop_scope="module")
async def test_points_credited_only_when_delivered(
    api_client: httpx.AsyncClient, cart, register_customer
) -> None:
    customer = await register_customer()
    kitchen_token = (await api_client.post("/auth/login", json=KONDAPUR_KITCHEN_LOGIN)).json()["access_token"]
    response = await api_client.post(
        "/orders", json=_order_body(cart, customer), headers=_auth(customer["token"])
    )
    assert response.status_code == 201, response.text
    public_id = response.json()["public_id"]
    await _pay(api_client, customer, public_id)
    assert await _balance_for(customer["phone"]) == 0
    for status in ("accepted", "preparing", "ready_for_pickup", "handed_to_rider"):
        driven = await _kitchen_drive(api_client, kitchen_token, public_id, status)
        assert driven.status_code == 200, driven.text
        assert await _balance_for(customer["phone"]) == 0
    delivered = await _kitchen_drive(api_client, kitchen_token, public_id, "delivered")
    assert delivered.status_code == 200, delivered.text
    assert await _balance_for(customer["phone"]) == 103


@pytest.mark.asyncio(loop_scope="module")
async def test_cancel_reverses_redemption_exactly_once(
    api_client: httpx.AsyncClient, cart, register_customer
) -> None:
    customer = await register_customer()
    kitchen_token = (await api_client.post("/auth/login", json=KONDAPUR_KITCHEN_LOGIN)).json()["access_token"]
    await _set_balance(customer["phone"], 500)
    response = await api_client.post(
        "/orders",
        json=_order_body(cart, customer, redeem_points=400),
        headers=_auth(customer["token"]),
    )
    assert response.status_code == 201, response.text
    public_id = response.json()["public_id"]
    await _pay(api_client, customer, public_id)
    assert await _balance_for(customer["phone"]) == 100
    cancelled = await _kitchen_drive(
        api_client, kitchen_token, public_id, "cancelled", reason="customer request"
    )
    assert cancelled.status_code == 200, cancelled.text
    assert await _balance_for(customer["phone"]) == 500
    again = await _kitchen_drive(api_client, kitchen_token, public_id, "cancelled")
    assert again.status_code == 422
    assert any(
        "cancellation reason is required" in row["message"]
        for row in again.json()["error"]["details"]
    )
    assert await _balance_for(customer["phone"]) == 500
    async with get_session_factory()() as session:
        user = await session.scalar(select(User).where(User.phone == customer["phone"]))
        reversals = (
            await session.scalars(
                select(LoyaltyTransaction).where(
                    LoyaltyTransaction.user_id == user.id,
                    LoyaltyTransaction.type == "reverse",
                )
            )
        ).all()
    assert len(reversals) == 1
    assert reversals[0].points == 400


@pytest.mark.asyncio(loop_scope="module")
async def test_coupon_per_user_and_total_limits(
    api_client: httpx.AsyncClient, cart, register_customer
) -> None:
    admin_token = await _admin_token(api_client)
    suffix = secrets.token_hex(4).upper()
    per_user_code = f"APIPU{suffix}"
    total_code = f"APITC{suffix}"
    created_per_user = await api_client.post(
        "/admin/coupons",
        json={"code": per_user_code, "type": "flat", "value": 150, "usage_limit_per_user": 1},
        headers=_auth(admin_token),
    )
    assert created_per_user.status_code == 201, created_per_user.text
    created_total = await api_client.post(
        "/admin/coupons",
        json={"code": total_code, "type": "flat", "value": 150, "usage_limit_total": 1},
        headers=_auth(admin_token),
    )
    assert created_total.status_code == 201, created_total.text

    first = await register_customer(per_user_code)
    second = await register_customer(per_user_code)
    ok_first = await api_client.post(
        "/orders",
        json=_order_body(cart, first, coupon_code=per_user_code),
        headers=_auth(first["token"]),
    )
    assert ok_first.status_code == 201, ok_first.text
    assert ok_first.json()["coupon_discount_inr"] == 150
    repeat_first = await api_client.post(
        "/orders",
        json=_order_body(cart, first, coupon_code=per_user_code),
        headers=_auth(first["token"]),
    )
    assert repeat_first.status_code == 422, repeat_first.text
    assert _error(repeat_first) == "This coupon has already been used on this account."
    ok_second = await api_client.post(
        "/orders",
        json=_order_body(cart, second, coupon_code=per_user_code),
        headers=_auth(second["token"]),
    )
    assert ok_second.status_code == 201, ok_second.text

    third = await register_customer(total_code)
    total_ok = await api_client.post(
        "/orders",
        json=_order_body(cart, third, coupon_code=total_code),
        headers=_auth(third["token"]),
    )
    assert total_ok.status_code == 201, total_ok.text
    fourth = await register_customer(total_code)
    total_exhausted = await api_client.post(
        "/orders",
        json=_order_body(cart, fourth, coupon_code=total_code),
        headers=_auth(fourth["token"]),
    )
    assert total_exhausted.status_code == 422, total_exhausted.text
    assert _error(total_exhausted) == "This coupon has reached its usage limit."


@pytest.mark.asyncio(loop_scope="module")
async def test_first_order_only_coupons_expire_after_one_paid_order(
    api_client: httpx.AsyncClient, cart, register_customer
) -> None:
    customer = await register_customer()
    first = await api_client.post(
        "/orders",
        json=_order_body(cart, customer, coupon_code="WELCOME100"),
        headers=_auth(customer["token"]),
    )
    assert first.status_code == 201, first.text
    assert first.json()["coupon_code"] == "WELCOME100"
    assert first.json()["coupon_discount_inr"] == 100
    assert first.json()["total_inr"] == 930
    await _pay(api_client, customer, first.json()["public_id"])
    second = await api_client.post(
        "/orders",
        json=_order_body(cart, customer, coupon_code="WELCOME100"),
        headers=_auth(customer["token"]),
    )
    assert second.status_code == 422, second.text
    assert _error(second) == "This coupon is for the first order only."


@pytest.mark.asyncio(loop_scope="module")
async def test_quote_matches_created_order_totals(
    api_client: httpx.AsyncClient, cart, register_customer
) -> None:
    customer = await register_customer()
    await _set_balance(customer["phone"], 500)
    quote_body = {
        "outlet_id": cart["outlet_id"],
        "items": [cart["line"]],
        "redeem_points": 200,
        "coupon_code": "BIRYANI10",
    }
    quote = await api_client.post("/orders/quote", json=quote_body, headers=_auth(customer["token"]))
    assert quote.status_code == 200, quote.text
    expected = {
        "items_subtotal_inr": 1030,
        "coupon_discount_inr": 103,
        "points_discount_inr": 100,
        "delivery_fee_inr": 0,
        "total_inr": 827,
        "coupon_code": "BIRYANI10",
        "earn_points": 92,
    }
    for field, value in expected.items():
        assert quote.json()[field] == value, field
    created = await api_client.post("/orders", json=_order_body(cart, customer, coupon_code="BIRYANI10", redeem_points=200), headers=_auth(customer["token"]))
    assert created.status_code == 201, created.text
    for field, value in expected.items():
        assert created.json()[field] == value, field


@pytest.mark.asyncio(loop_scope="module")
async def test_only_admin_can_manage_coupons(api_client: httpx.AsyncClient, register_customer) -> None:
    customer = await register_customer()
    customer_list = await api_client.get("/admin/coupons", headers=_auth(customer["token"]))
    assert customer_list.status_code == 403
    customer_create = await api_client.post(
        "/admin/coupons",
        json={"code": "NOPE1", "type": "flat", "value": 10},
        headers=_auth(customer["token"]),
    )
    assert customer_create.status_code == 403
    kitchen_token = (await api_client.post("/auth/login", json=KONDAPUR_KITCHEN_LOGIN)).json()["access_token"]
    kitchen_list = await api_client.get("/admin/coupons", headers=_auth(kitchen_token))
    assert kitchen_list.status_code == 403
    admin_list = await api_client.get("/admin/coupons", headers=_auth(await _admin_token(api_client)))
    assert admin_list.status_code == 200, admin_list.text
    assert "FREESHIP" in {row["code"] for row in admin_list.json()}


@pytest.mark.asyncio(loop_scope="module")
async def test_one_coupon_redemption_per_order(
    api_client: httpx.AsyncClient, cart, register_customer
) -> None:
    customer = await register_customer()
    response = await api_client.post(
        "/orders",
        json=_order_body(cart, customer, coupon_code="BIRYANI10"),
        headers=_auth(customer["token"]),
    )
    assert response.status_code == 201, response.text
    public_id = response.json()["public_id"]
    async with get_session_factory()() as session:
        order = await session.scalar(select(Order).where(Order.public_id == public_id))
        assert order is not None
        user = await session.scalar(select(User).where(User.phone == customer["phone"]))
        other = await session.scalar(select(Coupon).where(Coupon.code == "FREESHIP"))
        session.add(CouponRedemption(coupon_id=other.id, user_id=user.id, order_id=order.id))
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()


@pytest.mark.asyncio(loop_scope="module")
async def test_cancel_before_payment_releases_coupon(
    api_client: httpx.AsyncClient, cart, register_customer
) -> None:
    """Cancelling an unpaid customer order releases its coupon redemption, so the same customer can reuse the coupon."""
    admin_token = await _admin_token(api_client)
    suffix = secrets.token_hex(4).upper()
    code = f"APIRC{suffix}"
    created = await api_client.post(
        "/admin/coupons",
        json={"code": code, "type": "flat", "value": 150, "usage_limit_per_user": 1},
        headers=_auth(admin_token),
    )
    assert created.status_code == 201, created.text
    customer = await register_customer(code)

    first = await api_client.post(
        "/orders",
        json=_order_body(cart, customer, coupon_code=code),
        headers=_auth(customer["token"]),
    )
    assert first.status_code == 201, first.text
    assert first.json()["coupon_discount_inr"] == 150

    cancelled = await api_client.post(
        f"/orders/{first.json()['public_id']}/cancel",
        json={"reason": "customer request"},
        headers=_auth(customer["token"]),
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["cancellation_reason"] == "customer request"

    repeat = await api_client.post(
        f"/orders/{cancelled.json()['public_id']}/cancel",
        json={"reason": "second request"},
        headers=_auth(customer["token"]),
    )
    assert repeat.status_code == 409, repeat.text

    again = await api_client.post(
        "/orders",
        json=_order_body(cart, customer, coupon_code=code),
        headers=_auth(customer["token"]),
    )
    assert again.status_code == 201, again.text
    assert again.json()["coupon_discount_inr"] == 150
    assert await _balance_for(customer["phone"]) == 0


@pytest.mark.asyncio(loop_scope="module")
async def test_freeship_waives_delivery_fee(
    api_client: httpx.AsyncClient, small_cart, register_customer
) -> None:
    """FREESHIP (flat Rs 30, min Rs 249) offsets the Rs 30 fee end to end: the customer pays only item prices."""
    customer = await register_customer()
    quote = await api_client.post(
        "/orders/quote",
        json={
            "outlet_id": small_cart["outlet_id"],
            "items": [small_cart["line"]],
            "coupon_code": "FREESHIP",
        },
        headers=_auth(customer["token"]),
    )
    assert quote.status_code == 200, quote.text
    expected = {
        "items_subtotal_inr": 300,
        "coupon_discount_inr": 30,
        "points_discount_inr": 0,
        "delivery_fee_inr": 30,
        "total_inr": 300,
        "coupon_code": "FREESHIP",
        "earn_points": 27,
    }
    for field, value in expected.items():
        assert quote.json()[field] == value, field

    created = await api_client.post(
        "/orders",
        json=_order_body(small_cart, customer, coupon_code="FREESHIP"),
        headers=_auth(customer["token"]),
    )
    assert created.status_code == 201, created.text
    for field, value in expected.items():
        assert created.json()[field] == value, field
    assert created.json()["total_inr"] == created.json()["items_subtotal_inr"]


@pytest.mark.asyncio(loop_scope="module")
async def test_cancelled_order_earns_no_points(
    api_client: httpx.AsyncClient, cart, register_customer
) -> None:
    """Points are only earned on delivered orders: a cancelled (paid) order earns nothing."""
    customer = await register_customer()
    kitchen_token = (await api_client.post("/auth/login", json=KONDAPUR_KITCHEN_LOGIN)).json()["access_token"]
    response = await api_client.post(
        "/orders", json=_order_body(cart, customer), headers=_auth(customer["token"])
    )
    assert response.status_code == 201, response.text
    public_id = response.json()["public_id"]
    await _pay(api_client, customer, public_id)
    assert await _balance_for(customer["phone"]) == 0

    cancelled = await _kitchen_drive(api_client, kitchen_token, public_id, "cancelled", reason="customer request")
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"

    assert await _balance_for(customer["phone"]) == 0
    async with get_session_factory()() as session:
        order = await session.scalar(select(Order).where(Order.public_id == public_id))
        assert order is not None
        user = await session.scalar(select(User).where(User.phone == customer["phone"]))
        assert user is not None
        account = await get_or_create_account(session, user.id)
        assert account.lifetime_points == 0
        earns = (
            await session.scalars(
                select(LoyaltyTransaction).where(
                    LoyaltyTransaction.order_id == order.id,
                    LoyaltyTransaction.type == "earn",
                )
            )
        ).all()
    assert len(earns) == 0


@pytest.mark.asyncio(loop_scope="module")
async def test_points_balance_never_goes_negative(
    api_client: httpx.AsyncClient, cart, register_customer
) -> None:
    """Several redemptions drain the balance to exactly zero and further redemptions are rejected, never negative."""
    customer = await register_customer()
    await _set_balance(customer["phone"], 700)
    for redeem_points, remaining in ((200, 500), (200, 300), (300, 0)):
        response = await api_client.post(
            "/orders",
            json=_order_body(cart, customer, redeem_points=redeem_points),
            headers=_auth(customer["token"]),
        )
        assert response.status_code == 201, response.text
        assert response.json()["redeemed_points"] == redeem_points
        balance = await _balance_for(customer["phone"])
        assert balance == remaining
        assert balance >= 0

    exhausted = await api_client.post(
        "/orders",
        json=_order_body(cart, customer, redeem_points=200),
        headers=_auth(customer["token"]),
    )
    assert exhausted.status_code == 422, exhausted.text
    assert "At least 200 points" in _error(exhausted)
    assert await _balance_for(customer["phone"]) == 0


@pytest.mark.asyncio(loop_scope="module")
async def test_quote_equals_created_order_below_free_ship_threshold(
    api_client: httpx.AsyncClient, small_cart, register_customer
) -> None:
    """Quote and created order must agree for a sub-Rs500 order: fee Rs 30, coupon and redeemed points together."""
    customer = await register_customer()
    await _set_balance(customer["phone"], 500)
    quote_body = {
        "outlet_id": small_cart["outlet_id"],
        "items": [small_cart["line"]],
        "redeem_points": 100,
        "coupon_code": "BIRYANI10",
    }
    quote = await api_client.post("/orders/quote", json=quote_body, headers=_auth(customer["token"]))
    assert quote.status_code == 200, quote.text
    expected = {
        "items_subtotal_inr": 300,
        "coupon_discount_inr": 30,
        "points_discount_inr": 50,
        "delivery_fee_inr": 30,
        "total_inr": 250,
        "coupon_code": "BIRYANI10",
        "earn_points": 27,
    }
    for field, value in expected.items():
        assert quote.json()[field] == value, field
    created = await api_client.post(
        "/orders",
        json=_order_body(small_cart, customer, coupon_code="BIRYANI10", redeem_points=100),
        headers=_auth(customer["token"]),
    )
    assert created.status_code == 201, created.text
    for field, value in expected.items():
        assert created.json()[field] == value, field
    assert await _balance_for(customer["phone"]) == 400


@pytest.mark.asyncio(loop_scope="module")
async def test_coupon_eligible_lists_demo_coupons_with_reasons(
    api_client: httpx.AsyncClient, cart, small_cart, register_customer
) -> None:
    """POST /coupons/eligible returns every active demo coupon with reasons for the ineligible ones."""
    customer = await register_customer()
    response = await api_client.post(
        "/coupons/eligible",
        json={"outlet_id": cart["outlet_id"], "items": [cart["line"]]},
        headers=_auth(customer["token"]),
    )
    assert response.status_code == 200, response.text
    rows = {row["code"]: row for row in response.json()}
    demo_codes = {"WELCOME100", "BIRYANI10", "PARTY15", "FREESHIP"}
    for row in rows.values():
        assert row["description"], row
    assert demo_codes <= set(rows)
    # A fresh customer's Rs 1030 cart: WELCOME100, BIRYANI10 and FREESHIP apply; PARTY15 needs Rs 470 more.
    assert rows["WELCOME100"]["eligible"] is True
    assert rows["WELCOME100"]["discount_inr"] == 100
    assert rows["BIRYANI10"]["eligible"] is True
    assert rows["BIRYANI10"]["discount_inr"] == 103
    assert rows["FREESHIP"]["eligible"] is True
    assert rows["FREESHIP"]["discount_inr"] == 30
    assert rows["PARTY15"]["eligible"] is False
    assert rows["PARTY15"]["discount_inr"] == 0
    assert rows["PARTY15"]["reason"] == "Add Rs 470 more to use this coupon."

    # Sub-Rs 500 cart: WELCOME100 falls short of its Rs 399 minimum by Rs 99.
    small_response = await api_client.post(
        "/coupons/eligible",
        json={"outlet_id": small_cart["outlet_id"], "items": [small_cart["line"]]},
        headers=_auth(customer["token"]),
    )
    assert small_response.status_code == 200, small_response.text
    small_rows = {row["code"]: row for row in small_response.json()}
    assert small_rows["WELCOME100"]["eligible"] is False
    assert small_rows["WELCOME100"]["reason"] == "Add Rs 99 more to use this coupon."
    assert small_rows["BIRYANI10"]["eligible"] is True


@pytest.mark.asyncio(loop_scope="module")
async def test_coupon_eligible_is_customer_only(
    api_client: httpx.AsyncClient, cart, register_customer
) -> None:
    customer = await register_customer()
    kitchen_token = (await api_client.post("/auth/login", json=KONDAPUR_KITCHEN_LOGIN)).json()["access_token"]
    body = {"outlet_id": cart["outlet_id"], "items": [cart["line"]]}
    anonymous = await api_client.post("/coupons/eligible", json=body)
    assert anonymous.status_code == 401
    kitchen = await api_client.post("/coupons/eligible", json=body, headers=_auth(kitchen_token))
    assert kitchen.status_code == 403
