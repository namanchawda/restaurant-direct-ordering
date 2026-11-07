from datetime import UTC, datetime, timedelta
import secrets

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_role, require_roles
from app.core.config import get_settings
from app.models import MenuItem, Outlet, PartyOrder, PartyStatusEvent, User
from app.schemas import CancelRequest, PartyConfirmRequest, PartyOrderCreate, PartyQuoteRequest, PartyRejectRequest, PaymentRequest
from app.services.party_orders import advance_amount, can_transition, guest_limit_message, party_date_limit_message, party_event_at, party_notice_message, total_limit_message

router = APIRouter(tags=["party-orders"])


def _now() -> datetime:
    return datetime.now(UTC)


async def _get_party(session: AsyncSession, public_id: str) -> PartyOrder:
    party = await session.scalar(
        select(PartyOrder).options(
            selectinload(PartyOrder.status_events), selectinload(PartyOrder.outlet)
        ).where(PartyOrder.public_id == public_id)
    )
    if party is None:
        raise HTTPException(status_code=404, detail="Party order not found.")
    return party


async def _new_public_id(session: AsyncSession) -> str:
    for _ in range(10):
        candidate = f"PARTY-{secrets.randbelow(1_000_000):06d}"
        if await session.scalar(select(PartyOrder.id).where(PartyOrder.public_id == candidate)) is None:
            return candidate
    raise HTTPException(status_code=503, detail="Could not allocate a party order number. Please retry.")


def _serialize_party(party: PartyOrder) -> dict[str, object]:
    return {
        "public_id": party.public_id,
        "user_id": str(party.user_id),
        "outlet_id": str(party.outlet_id),
        "outlet_name": party.outlet.name if party.outlet else None,
        "event_date": party.event_date,
        "event_time": party.event_time,
        "guests": party.guests,
        "delivery_or_pickup": party.delivery_or_pickup,
        "address": party.address,
        "contact_name": party.contact_name,
        "contact_phone": party.contact_phone,
        "notes": party.notes,
        "status": party.status,
        "items": party.items,
        "estimated_total_inr": party.estimated_total_inr,
        "advance_inr": party.advance_inr,
        "advance_payment_status": party.advance_payment_status,
        "manager_note": party.manager_note,
        "confirmed_by": str(party.confirmed_by) if party.confirmed_by else None,
        "confirmed_at": party.confirmed_at,
        "created_at": party.created_at,
        "updated_at": party.updated_at,
        "price_note": "incl. 5% GST",
        "status_history": [
            {"status": event.status, "at": event.at, "note": event.note}
            for event in sorted(party.status_events, key=lambda event: event.at)
        ],
    }


async def _priced_items(session: AsyncSession, outlet: Outlet, requested_items) -> tuple[list[dict[str, object]], int]:
    snapshots: list[dict[str, object]] = []
    estimated_total = 0
    for line in requested_items:
        item = await session.scalar(select(MenuItem).options(
            selectinload(MenuItem.variants), selectinload(MenuItem.city_prices)
        ).where(MenuItem.id == line.item_id))
        if item is None or not item.active:
            raise HTTPException(status_code=409, detail="One or more menu items are unavailable.")
        unit_price = next(
            (price.price_inr for price in item.city_prices if price.city.casefold() == outlet.city.casefold()),
            item.base_price_inr,
        )
        variant_name = None
        if line.variant_id is not None:
            variant = next((candidate for candidate in item.variants if candidate.id == line.variant_id), None)
            if variant is None:
                raise HTTPException(status_code=422, detail="The selected variant does not belong to this item.")
            unit_price, variant_name = variant.price_inr, variant.name
        estimated_total += unit_price * line.quantity
        snapshots.append({
            "item_id": str(item.id), "name": item.name, "variant": variant_name,
            "quantity": line.quantity, "unit_price_inr": unit_price,
        })
    return snapshots, estimated_total


def _party_error(message: str) -> HTTPException:
    return HTTPException(status_code=422, detail=message)


@router.post("/party-orders", status_code=201)
async def create_party_order(payload: PartyOrderCreate, user: User = Depends(require_role("customer")), session: AsyncSession = Depends(get_db)) -> dict[str, object]:
    settings = get_settings()
    outlet = await session.get(Outlet, payload.outlet_id)
    if outlet is None:
        raise HTTPException(status_code=404, detail="Outlet not found.")
    if not outlet.is_open or not outlet.accepts_party_orders:
        raise HTTPException(status_code=409, detail="This outlet is not accepting party orders.")
    now = _now()
    event_at = party_event_at(payload.event_date, payload.event_time)
    for message in (
        party_notice_message(event_at, now, settings.party_min_notice_hours),
        party_date_limit_message(event_at, now, settings.party_max_days_ahead),
        guest_limit_message(payload.guests, settings.party_min_guests, settings.party_max_guests),
    ):
        if message:
            raise _party_error(message)
    snapshots, estimated_total = await _priced_items(session, outlet, payload.items)
    if message := total_limit_message(estimated_total, settings.party_min_total_inr):
        raise _party_error(message)
    party = PartyOrder(
        public_id=await _new_public_id(session), user_id=user.id, outlet_id=outlet.id,
        event_date=payload.event_date, event_time=payload.event_time, guests=payload.guests,
        delivery_or_pickup=payload.delivery_or_pickup, address=payload.address,
        contact_name=payload.contact_name, contact_phone=payload.contact_phone, notes=payload.notes,
        status="requested", items=snapshots, estimated_total_inr=estimated_total,
        advance_inr=advance_amount(estimated_total, settings.party_advance_percent),
        advance_payment_status="pending",
    )
    party.status_events.append(PartyStatusEvent(status="requested", at=now, note=None))
    session.add(party)
    await session.commit()
    return _serialize_party(await _get_party(session, party.public_id))


@router.post("/party-orders/quote")
async def quote_party_order(payload: PartyQuoteRequest, session: AsyncSession = Depends(get_db)) -> dict[str, object]:
    outlet = await session.get(Outlet, payload.outlet_id)
    if outlet is None:
        raise HTTPException(status_code=404, detail="Outlet not found.")
    if not outlet.is_open or not outlet.accepts_party_orders:
        raise HTTPException(status_code=409, detail="This outlet is not accepting party orders.")
    items, estimated_total = await _priced_items(session, outlet, payload.items)
    settings = get_settings()
    return {
        "items": items,
        "estimated_total_inr": estimated_total,
        "advance_inr": advance_amount(estimated_total, settings.party_advance_percent),
        "minimum_total_inr": settings.party_min_total_inr,
        "price_note": "incl. 5% GST",
    }


@router.get("/party-orders/mine")
async def my_party_orders(user: User = Depends(require_role("customer")), session: AsyncSession = Depends(get_db)) -> list[dict[str, object]]:
    parties = (await session.scalars(select(PartyOrder).options(
        selectinload(PartyOrder.status_events), selectinload(PartyOrder.outlet)
    ).where(PartyOrder.user_id == user.id).order_by(PartyOrder.created_at.desc()))).all()
    return [_serialize_party(party) for party in parties]


@router.get("/party-orders/{public_id}")
async def get_my_party_order(public_id: str, user: User = Depends(require_role("customer")), session: AsyncSession = Depends(get_db)) -> dict[str, object]:
    party = await _get_party(session, public_id)
    if party.user_id != user.id:
        raise HTTPException(status_code=404, detail="Party order not found.")
    return _serialize_party(party)


@router.post("/party-orders/{public_id}/cancel")
async def cancel_party_order(public_id: str, payload: CancelRequest, user: User = Depends(require_role("customer")), session: AsyncSession = Depends(get_db)) -> dict[str, object]:
    party = await _get_party(session, public_id)
    if party.user_id != user.id:
        raise HTTPException(status_code=404, detail="Party order not found.")
    if not can_transition(party.status, "cancelled"):
        raise HTTPException(status_code=409, detail=f"Cannot cancel a party order from {party.status}.")
    if party_event_at(party.event_date, party.event_time) <= _now() + timedelta(hours=get_settings().party_min_notice_hours):
        raise HTTPException(status_code=409, detail="Party orders can only be cancelled more than 24 hours before the event.")
    party.status = "cancelled"
    party.manager_note = payload.reason
    party.status_events.append(PartyStatusEvent(status="cancelled", at=_now(), note=payload.reason))
    await session.commit()
    return _serialize_party(await _get_party(session, public_id))


@router.get("/catering/party-orders")
async def catering_party_orders(status: str | None = Query(default=None), _: User = Depends(require_roles("catering", "admin")), session: AsyncSession = Depends(get_db)) -> list[dict[str, object]]:
    if status is not None and status not in {"requested", "confirmed", "rejected", "cancelled", "completed"}:
        raise _party_error("Invalid party order status.")
    statement = select(PartyOrder).options(selectinload(PartyOrder.status_events), selectinload(PartyOrder.outlet)).order_by(PartyOrder.event_date, PartyOrder.event_time)
    if status is not None:
        statement = statement.where(PartyOrder.status == status)
    return [_serialize_party(party) for party in (await session.scalars(statement)).all()]


@router.patch("/catering/party-orders/{public_id}/confirm")
async def confirm_party_order(public_id: str, payload: PartyConfirmRequest, manager: User = Depends(require_roles("catering", "admin")), session: AsyncSession = Depends(get_db)) -> dict[str, object]:
    party = await _get_party(session, public_id)
    if not can_transition(party.status, "confirmed"):
        raise HTTPException(status_code=409, detail=f"Cannot confirm a party order from {party.status}.")
    settings = get_settings()
    total = payload.adjusted_total_inr if payload.adjusted_total_inr is not None else party.estimated_total_inr
    if message := total_limit_message(total, settings.party_min_total_inr):
        raise _party_error(message)
    party.status = "confirmed"
    party.estimated_total_inr = total
    party.advance_inr = advance_amount(total, settings.party_advance_percent)
    party.manager_note = payload.manager_note
    party.confirmed_by = manager.id
    party.confirmed_at = _now()
    party.status_events.append(PartyStatusEvent(status="confirmed", at=_now(), note=payload.manager_note))
    await session.commit()
    return _serialize_party(await _get_party(session, public_id))


@router.patch("/catering/party-orders/{public_id}/reject")
async def reject_party_order(public_id: str, payload: PartyRejectRequest, _: User = Depends(require_roles("catering", "admin")), session: AsyncSession = Depends(get_db)) -> dict[str, object]:
    party = await _get_party(session, public_id)
    if not can_transition(party.status, "rejected"):
        raise HTTPException(status_code=409, detail=f"Cannot reject a party order from {party.status}.")
    party.status = "rejected"
    party.manager_note = payload.reason
    party.status_events.append(PartyStatusEvent(status="rejected", at=_now(), note=payload.reason))
    await session.commit()
    return _serialize_party(await _get_party(session, public_id))


@router.patch("/catering/party-orders/{public_id}/complete")
async def complete_party_order(public_id: str, _: User = Depends(require_roles("catering", "admin")), session: AsyncSession = Depends(get_db)) -> dict[str, object]:
    party = await _get_party(session, public_id)
    if not can_transition(party.status, "completed"):
        raise HTTPException(status_code=409, detail=f"Cannot complete a party order from {party.status}.")
    party.status = "completed"
    party.status_events.append(PartyStatusEvent(status="completed", at=_now(), note=None))
    await session.commit()
    return _serialize_party(await _get_party(session, public_id))


@router.post("/party-orders/{public_id}/pay-advance")
async def pay_party_advance(public_id: str, payload: PaymentRequest, user: User = Depends(require_role("customer")), session: AsyncSession = Depends(get_db)) -> dict[str, object]:
    party = await _get_party(session, public_id)
    if party.user_id != user.id:
        raise HTTPException(status_code=404, detail="Party order not found.")
    if party.status != "confirmed":
        raise HTTPException(status_code=409, detail="Party advance payment is available only after confirmation.")
    if party.advance_payment_status == "paid":
        return {"public_id": party.public_id, "advance_payment_status": "paid", "advance_inr": party.advance_inr}
    upi_id = payload.upi_id.strip() if payload.upi_id else None
    card_number = "".join(payload.card_number.split()) if payload.card_number else None
    if upi_id and card_number:
        raise HTTPException(status_code=422, detail="Provide either a UPI ID or a card number, not both.")
    if upi_id:
        party.advance_payment_status = "failed" if upi_id.endswith("@fail") else "paid"
    elif card_number:
        party.advance_payment_status = "failed" if card_number == "4000000000000002" else "paid"
    else:
        raise HTTPException(status_code=422, detail="Provide a UPI ID or a card number for this payment.")
    await session.commit()
    return {"public_id": party.public_id, "advance_payment_status": party.advance_payment_status, "advance_inr": party.advance_inr}
