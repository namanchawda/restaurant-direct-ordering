"""Party-order API coverage. These tests require the configured test database."""

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
import secrets
from zoneinfo import ZoneInfo

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from app.db.session import get_session_factory
from app.main import app
from app.models import MenuItem, Outlet, PartyOrder, PartyStatusEvent, User
from app.seed import seed_data

IST = ZoneInfo("Asia/Kolkata")


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
async def party_setup(api_client: httpx.AsyncClient) -> AsyncIterator[dict[str, object]]:
    phones: list[str] = []

    async def register(name: str = "Party Test Customer") -> dict[str, str]:
        phone = f"7000{secrets.randbelow(10_000_000):07d}"
        phones.append(phone)
        await api_client.post("/auth/otp/request", json={"phone": phone})
        response = await api_client.post("/auth/otp/verify", json={"phone": phone, "otp": "123456", "name": name})
        assert response.status_code == 200, response.text
        return {"phone": phone, "token": response.json()["access_token"]}

    async with get_session_factory()() as session:
        outlet = await session.scalar(select(Outlet).where(Outlet.name == "Kondapur"))
        item = await session.scalar(select(MenuItem).where(MenuItem.name == "Chicken dum biryani"))
    assert outlet is not None and item is not None

    try:
        yield {
            "register": register,
            "outlet_id": str(outlet.id),
            # Chicken dum biryani is Rs 380; 8 x Rs 380 = Rs 3,040 >= the Rs 3,000 minimum.
            "item_id": str(item.id),
            "item_price_inr": 380,
        }
    finally:
        async with get_session_factory()() as session:
            users = (await session.scalars(select(User).where(User.phone.in_(phones)))).all()
            user_ids = [user.id for user in users]
            party_ids = list((await session.scalars(select(PartyOrder.id).where(PartyOrder.user_id.in_(user_ids)))).all()) if user_ids else []
            if party_ids:
                await session.execute(delete(PartyStatusEvent).where(PartyStatusEvent.party_order_id.in_(party_ids)))
                await session.execute(delete(PartyOrder).where(PartyOrder.id.in_(party_ids)))
            for user in users:
                await session.delete(user)
            await session.commit()


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def error_message(response: httpx.Response) -> str:
    return response.json()["error"]["message"]


def slot(hours: int = 48) -> tuple[str, str]:
    value = (datetime.now(IST) + timedelta(hours=hours)).replace(second=0, microsecond=0)
    return value.date().isoformat(), value.time().isoformat(timespec="minutes")


def body(setup: dict[str, object], *, hours: int = 48, guests: int = 10, quantity: int | None = None) -> dict[str, object]:
    event_date, event_time = slot(hours)
    return {
        "outlet_id": setup["outlet_id"], "event_date": event_date, "event_time": event_time,
        "guests": guests, "delivery_or_pickup": "pickup", "contact_name": "Party Contact",
        "contact_phone": "7999999999", "items": [{"item_id": setup["item_id"], "quantity": quantity or 8}],
    }


async def catering_token(api_client: httpx.AsyncClient) -> str:
    response = await api_client.post("/auth/login", json={"phone": "9000000014", "password": "DemoCatering!2026"})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


@pytest.mark.asyncio(loop_scope="module")
async def test_create_notice_rejection_and_server_total(api_client: httpx.AsyncClient, party_setup: dict[str, object]) -> None:
    customer = await party_setup["register"]()
    created = await api_client.post("/party-orders", json=body(party_setup), headers=auth(customer["token"]))
    assert created.status_code == 201, created.text
    data = created.json()
    assert data["public_id"].startswith("PARTY-") and len(data["public_id"]) == 12
    assert data["estimated_total_inr"] >= 3000
    assert data["advance_inr"] == round(data["estimated_total_inr"] * 0.25)
    assert data["items"][0]["unit_price_inr"] > 0

    rejected = await api_client.post("/party-orders", json=body(party_setup, hours=12), headers=auth(customer["token"]))
    assert rejected.status_code == 422
    assert "Party orders need at least 24 hours notice." in error_message(rejected)


@pytest.mark.asyncio(loop_scope="module")
async def test_minimum_estimated_total_rejects_small_order(api_client: httpx.AsyncClient, party_setup: dict[str, object]) -> None:
    # 2 x Rs 380 = Rs 760, below the Rs 3,000 minimum; the rule must still reject it.
    customer = await party_setup["register"]()
    small = body(party_setup, quantity=2)
    rejected = await api_client.post("/party-orders", json=small, headers=auth(customer["token"]))
    assert rejected.status_code == 422
    assert "minimum estimated total of Rs 3000" in error_message(rejected)


@pytest.mark.asyncio(loop_scope="module")
async def test_own_only_access_and_role_isolation(api_client: httpx.AsyncClient, party_setup: dict[str, object]) -> None:
    owner = await party_setup["register"]()
    other = await party_setup["register"]()
    created = await api_client.post("/party-orders", json=body(party_setup), headers=auth(owner["token"]))
    public_id = created.json()["public_id"]
    assert (await api_client.get(f"/party-orders/{public_id}", headers=auth(other["token"]))).status_code == 404
    kitchen = await api_client.post("/auth/login", json={"phone": "9000000011", "password": "KondapurKitchen!2026"})
    assert (await api_client.get("/catering/party-orders", headers=auth(kitchen.json()["access_token"]))).status_code == 403
    assert (await api_client.get("/catering/party-orders", headers=auth(owner["token"]))).status_code == 403


@pytest.mark.asyncio(loop_scope="module")
async def test_confirm_reject_cancel_and_advance_payment(api_client: httpx.AsyncClient, party_setup: dict[str, object]) -> None:
    customer = await party_setup["register"]()
    manager = await catering_token(api_client)
    created = await api_client.post("/party-orders", json=body(party_setup), headers=auth(customer["token"]))
    public_id = created.json()["public_id"]
    before_confirm = await api_client.post(f"/party-orders/{public_id}/pay-advance", json={"upi_id": "customer@ok"}, headers=auth(customer["token"]))
    assert before_confirm.status_code == 409
    confirmed = await api_client.patch(f"/catering/party-orders/{public_id}/confirm", json={"manager_note": "Feasible"}, headers=auth(manager))
    assert confirmed.status_code == 200 and confirmed.json()["status"] == "confirmed"
    failed = await api_client.post(f"/party-orders/{public_id}/pay-advance", json={"upi_id": "customer@fail"}, headers=auth(customer["token"]))
    assert failed.status_code == 200 and failed.json()["advance_payment_status"] == "failed"
    paid = await api_client.post(f"/party-orders/{public_id}/pay-advance", json={"upi_id": "customer@ok"}, headers=auth(customer["token"]))
    assert paid.json()["advance_payment_status"] == "paid"
    completed = await api_client.patch(f"/catering/party-orders/{public_id}/complete", headers=auth(manager))
    assert completed.status_code == 200 and completed.json()["status"] == "completed"

    rejected_customer = await party_setup["register"]()
    rejected = await api_client.post("/party-orders", json=body(party_setup), headers=auth(rejected_customer["token"]))
    rejected_id = rejected.json()["public_id"]
    response = await api_client.patch(f"/catering/party-orders/{rejected_id}/reject", json={"reason": "Capacity unavailable"}, headers=auth(manager))
    assert response.status_code == 200 and response.json()["status"] == "rejected"


@pytest.mark.asyncio(loop_scope="module")
async def test_cancel_requires_more_than_notice_window(api_client: httpx.AsyncClient, party_setup: dict[str, object]) -> None:
    customer = await party_setup["register"]()
    created = await api_client.post("/party-orders", json=body(party_setup, hours=48), headers=auth(customer["token"]))
    public_id = created.json()["public_id"]
    async with get_session_factory()() as session:
        party = await session.scalar(select(PartyOrder).where(PartyOrder.public_id == public_id))
        near = datetime.now(IST) + timedelta(hours=23)
        party.event_date, party.event_time = near.date(), near.time().replace(second=0, microsecond=0)
        await session.commit()
    response = await api_client.post(f"/party-orders/{public_id}/cancel", json={"reason": "Plans changed"}, headers=auth(customer["token"]))
    assert response.status_code == 409
    assert "more than 24 hours" in error_message(response)
