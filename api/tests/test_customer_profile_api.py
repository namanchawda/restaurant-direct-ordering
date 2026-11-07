"""Customer profile, addresses and favourites API coverage. Requires the test database."""

from collections.abc import AsyncIterator
import secrets

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select

from app.db.session import get_session_factory
from app.main import app
from app.models import MenuItem
from app.seed import seed_data
from conftest import delete_customer_data


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def api_client() -> AsyncIterator[httpx.AsyncClient]:
    async with get_session_factory()() as session:
        await seed_data(session)
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            yield client
    finally:
        await get_session_factory().kw["bind"].dispose()
        get_session_factory.cache_clear()


@pytest_asyncio.fixture(loop_scope="module")
async def customer(api_client: httpx.AsyncClient) -> AsyncIterator[dict[str, object]]:
    phone = f"7000{secrets.randbelow(10_000_000):07d}"
    await api_client.post("/auth/otp/request", json={"phone": phone})
    response = await api_client.post(
        "/auth/otp/verify", json={"phone": phone, "otp": "123456", "name": "Profile Customer"}
    )
    assert response.status_code == 200, response.text
    token = response.json()["access_token"]
    try:
        yield {"phone": phone, "token": token}
    finally:
        await delete_customer_data(phone)


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def error_message(response: httpx.Response) -> str:
    return response.json()["error"]["message"]


def address_payload(label: str = "home", is_default: bool = False) -> dict[str, object]:
    return {
        "label": label,
        "address": f"{label} address, Hyderabad",
        "lat": 17.4649,
        "lng": 78.3639,
        "is_default": is_default,
    }


async def active_item_id(api_client: httpx.AsyncClient) -> str:
    async with get_session_factory()() as session:
        item = await session.scalar(select(MenuItem).where(MenuItem.active.is_(True)).limit(1))
    assert item is not None
    return str(item.id)


@pytest.mark.asyncio(loop_scope="module")
async def test_profile_get_and_patch(api_client: httpx.AsyncClient, customer: dict[str, object]) -> None:
    token = customer["token"]
    profile = await api_client.get("/me/profile", headers=auth(token))
    assert profile.status_code == 200, profile.text
    assert profile.json()["name"] == "Profile Customer"
    assert profile.json()["phone"] == customer["phone"]

    updated = await api_client.patch(
        "/me/profile", json={"name": "Updated Name", "marketing_opt_in": True}, headers=auth(token)
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "Updated Name"
    assert updated.json()["marketing_opt_in"] is True

    # Phone stays read-only: attempting to change it is ignored (not a field).
    again = await api_client.get("/me/profile", headers=auth(token))
    assert again.json()["phone"] == customer["phone"]


@pytest.mark.asyncio(loop_scope="module")
async def test_address_crud_and_default_switching(
    api_client: httpx.AsyncClient, customer: dict[str, object]
) -> None:
    token = customer["token"]

    created = await api_client.post(
        "/me/addresses", json=address_payload("home", True), headers=auth(token)
    )
    assert created.status_code == 201, created.text
    address_id = created.json()["id"]
    assert created.json()["is_default"] is True

    second = await api_client.post(
        "/me/addresses", json=address_payload("work", False), headers=auth(token)
    )
    assert second.status_code == 201, second.text
    second_id = second.json()["id"]

    # Listing returns both; home remains default.
    listed = await api_client.get("/me/addresses", headers=auth(token))
    assert listed.status_code == 200
    assert {row["id"] for row in listed.json()} == {address_id, second_id}
    defaults = [row for row in listed.json() if row["is_default"]]
    assert len(defaults) == 1 and defaults[0]["id"] == address_id

    # Switch default to work: home is cleared.
    switched = await api_client.patch(
        f"/me/addresses/{second_id}", json={"is_default": True}, headers=auth(token)
    )
    assert switched.status_code == 200, switched.text
    listed = await api_client.get("/me/addresses", headers=auth(token))
    defaults = [row for row in listed.json() if row["is_default"]]
    assert len(defaults) == 1 and defaults[0]["id"] == second_id
    home = next(row for row in listed.json() if row["id"] == address_id)
    assert home["is_default"] is False

    # Deleting the default promotes the most recent remaining address.
    deleted = await api_client.delete(f"/me/addresses/{second_id}", headers=auth(token))
    assert deleted.status_code == 204
    listed = await api_client.get("/me/addresses", headers=auth(token))
    assert len(listed.json()) == 1
    assert listed.json()[0]["id"] == address_id
    assert listed.json()[0]["is_default"] is True


@pytest.mark.asyncio(loop_scope="module")
async def test_address_limit_is_five(
    api_client: httpx.AsyncClient, customer: dict[str, object]
) -> None:
    token = customer["token"]
    labels = ["home", "work", "other", "home", "work"]  # valid AddressLabel values
    for index, label in enumerate(labels):
        response = await api_client.post(
            "/me/addresses",
            json=address_payload(label, index == 0),
            headers=auth(token),
        )
        assert response.status_code == 201, response.text
    # The 6th address is rejected even though it uses a valid label.
    over = await api_client.post(
        "/me/addresses", json=address_payload("other", False), headers=auth(token)
    )
    assert over.status_code == 409
    assert "up to 5 addresses" in error_message(over)


@pytest.mark.asyncio(loop_scope="module")
async def test_favourites_idempotent_and_active_only(
    api_client: httpx.AsyncClient, customer: dict[str, object]
) -> None:
    token = customer["token"]
    item_id = await active_item_id(api_client)

    added = await api_client.put(f"/me/favourites/{item_id}", headers=auth(token))
    assert added.status_code == 204, added.text
    # Idempotent: adding again still succeeds.
    added_again = await api_client.put(f"/me/favourites/{item_id}", headers=auth(token))
    assert added_again.status_code == 204

    favourites = await api_client.get("/me/favourites", headers=auth(token))
    assert favourites.status_code == 200
    ids = {row["item_id"] for row in favourites.json()}
    assert item_id in ids
    row = next(row for row in favourites.json() if row["item_id"] == item_id)
    assert "name" in row and "photo_url" in row and "price_inr" in row and "is_veg" in row

    removed = await api_client.delete(f"/me/favourites/{item_id}", headers=auth(token))
    assert removed.status_code == 204
    favourites = await api_client.get("/me/favourites", headers=auth(token))
    assert item_id not in {row["item_id"] for row in favourites.json()}


@pytest.mark.asyncio(loop_scope="module")
async def test_own_only_access_and_kitchen_403(
    api_client: httpx.AsyncClient, customer: dict[str, object]
) -> None:
    token = customer["token"]
    # Another customer cannot access this customer's data.
    other_phone = f"7000{secrets.randbelow(10_000_000):07d}"
    await api_client.post("/auth/otp/request", json={"phone": other_phone})
    other = await api_client.post(
        "/auth/otp/verify", json={"phone": other_phone, "otp": "123456", "name": "Other Customer"}
    )
    other_token = other.json()["access_token"]
    try:
        assert (await api_client.get("/me/profile", headers=auth(other_token))).status_code == 200
        assert (
            await api_client.post("/me/addresses", json=address_payload(), headers=auth(other_token))
        ).status_code == 201
        # kitchen role is refused on customer endpoints.
        kitchen = await api_client.post(
            "/auth/login", json={"phone": "9000000011", "password": "KondapurKitchen!2026"}
        )
        assert kitchen.status_code == 200
        kitchen_token = kitchen.json()["access_token"]
        assert (await api_client.get("/me/profile", headers=auth(kitchen_token))).status_code == 403
        assert (await api_client.get("/me/addresses", headers=auth(kitchen_token))).status_code == 403
        assert (await api_client.get("/me/favourites", headers=auth(kitchen_token))).status_code == 403
    finally:
        await delete_customer_data(other_phone)


@pytest.mark.asyncio(loop_scope="module")
async def test_delete_me_anonymises_and_keeps_orders(
    api_client: httpx.AsyncClient, customer: dict[str, object]
) -> None:
    token = customer["token"]
    item_id = await active_item_id(api_client)
    await api_client.post("/me/addresses", json=address_payload("home", True), headers=auth(token))
    await api_client.put(f"/me/favourites/{item_id}", headers=auth(token))

    response = await api_client.delete("/me", headers=auth(token))
    assert response.status_code == 204, response.text

    # The account is anonymised in place (kept for orders): name and phone are
    # cleared, and addresses/favourites are gone.
    profile = await api_client.get("/me/profile", headers=auth(token))
    assert profile.status_code == 200, profile.text
    assert profile.json()["name"] == "Deleted Customer"
    assert profile.json()["phone"].startswith("del-")
    addresses = await api_client.get("/me/addresses", headers=auth(token))
    assert addresses.status_code == 200
    assert addresses.json() == []
    favourites = await api_client.get("/me/favourites", headers=auth(token))
    assert favourites.status_code == 200
    assert favourites.json() == []
