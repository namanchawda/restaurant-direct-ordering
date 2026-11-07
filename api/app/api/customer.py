"""Customer profile, saved addresses and favourites (customer role, own data only)."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_role
from app.models import (
    CustomerAddress,
    CustomerFavorite,
    MenuItem,
    User,
)
from app.schemas import (
    CustomerAddressCreate,
    CustomerAddressResponse,
    CustomerAddressUpdate,
    CustomerFavoriteItem,
    CustomerProfileResponse,
    CustomerProfileUpdate,
)
from app.services.customer_profile import (
    ADDRESS_LIMIT,
    address_limit_error,
    at_address_limit,
    default_switch_plan,
)

router = APIRouter(prefix="/me", tags=["customer profile"])


async def _get_address(
    session: AsyncSession, user: User, address_id: UUID
) -> CustomerAddress:
    address = await session.scalar(
        select(CustomerAddress).where(
            CustomerAddress.id == address_id, CustomerAddress.user_id == user.id
        )
    )
    if address is None:
        raise HTTPException(status_code=404, detail="Address not found.")
    return address


@router.get("/profile", response_model=CustomerProfileResponse)
async def get_profile(user: User = Depends(require_role("customer"))) -> CustomerProfileResponse:
    return CustomerProfileResponse(
        id=user.id,
        name=user.name,
        phone=user.phone,
        marketing_opt_in=user.marketing_opt_in,
        created_at=user.created_at,
    )


@router.patch("/profile", response_model=CustomerProfileResponse)
async def patch_profile(
    payload: CustomerProfileUpdate,
    user: User = Depends(require_role("customer")),
    session: AsyncSession = Depends(get_db),
) -> CustomerProfileResponse:
    if payload.name is not None:
        user.name = payload.name
    if payload.marketing_opt_in is not None:
        user.marketing_opt_in = payload.marketing_opt_in
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return CustomerProfileResponse(
        id=user.id,
        name=user.name,
        phone=user.phone,
        marketing_opt_in=user.marketing_opt_in,
        created_at=user.created_at,
    )


@router.get("/addresses", response_model=list[CustomerAddressResponse])
async def list_addresses(
    user: User = Depends(require_role("customer")),
    session: AsyncSession = Depends(get_db),
) -> list[CustomerAddressResponse]:
    addresses = (
        await session.scalars(
            select(CustomerAddress)
            .where(CustomerAddress.user_id == user.id)
            .order_by(CustomerAddress.created_at.desc())
        )
    ).all()
    return [
        CustomerAddressResponse(
            id=a.id,
            user_id=a.user_id,
            label=a.label,
            address=a.address,
            lat=a.lat,
            lng=a.lng,
            is_default=a.is_default,
            created_at=a.created_at,
        )
        for a in addresses
    ]


@router.post("/addresses", response_model=CustomerAddressResponse, status_code=201)
async def create_address(
    payload: CustomerAddressCreate,
    user: User = Depends(require_role("customer")),
    session: AsyncSession = Depends(get_db),
) -> CustomerAddressResponse:
    current_count = await session.scalar(
        select(func.count()).select_from(CustomerAddress).where(
            CustomerAddress.user_id == user.id
        )
    )
    if current_count is None:
        current_count = 0
    if at_address_limit(int(current_count)):
        raise HTTPException(status_code=409, detail=address_limit_error())

    if payload.is_default:
        await session.execute(
            CustomerAddress.__table__.update().where(
                CustomerAddress.user_id == user.id,
                CustomerAddress.is_default.is_(True),
            ).values(is_default=False)
        )
    address = CustomerAddress(
        user_id=user.id,
        label=payload.label,
        address=payload.address,
        lat=payload.lat,
        lng=payload.lng,
        is_default=payload.is_default,
    )
    session.add(address)
    await session.commit()
    await session.refresh(address)
    return CustomerAddressResponse(
        id=address.id,
        user_id=address.user_id,
        label=address.label,
        address=address.address,
        lat=address.lat,
        lng=address.lng,
        is_default=address.is_default,
        created_at=address.created_at,
    )


@router.patch("/addresses/{address_id}", response_model=CustomerAddressResponse)
async def patch_address(
    address_id: UUID,
    payload: CustomerAddressUpdate,
    user: User = Depends(require_role("customer")),
    session: AsyncSession = Depends(get_db),
) -> CustomerAddressResponse:
    address = await _get_address(session, user, address_id)

    if payload.is_default is True:
        addresses = (
            await session.scalars(
                select(CustomerAddress).where(CustomerAddress.user_id == user.id)
            )
        ).all()
        address_dicts = [
            {
                "id": a.id,
                "is_default": a.is_default,
            }
            for a in addresses
        ]
        clear_ids, _ = default_switch_plan(
            address_dicts, address_id
        )
        if clear_ids:
            await session.execute(
                CustomerAddress.__table__.update().where(
                    CustomerAddress.user_id == user.id,
                    CustomerAddress.id.in_(clear_ids),
                ).values(is_default=False)
            )

    if payload.label is not None:
        address.label = payload.label
    if payload.address is not None:
        address.address = payload.address
    if payload.lat is not None:
        address.lat = payload.lat
    if payload.lng is not None:
        address.lng = payload.lng
    if payload.is_default is not None:
        address.is_default = payload.is_default

    session.add(address)
    await session.commit()
    await session.refresh(address)
    return CustomerAddressResponse(
        id=address.id,
        user_id=address.user_id,
        label=address.label,
        address=address.address,
        lat=address.lat,
        lng=address.lng,
        is_default=address.is_default,
        created_at=address.created_at,
    )


@router.delete("/addresses/{address_id}", status_code=204)
async def delete_address(
    address_id: UUID,
    user: User = Depends(require_role("customer")),
    session: AsyncSession = Depends(get_db),
) -> None:
    address = await _get_address(session, user, address_id)
    was_default = address.is_default
    await session.delete(address)
    await session.commit()

    if was_default:
        addresses = (
            await session.scalars(
                select(CustomerAddress)
                .where(CustomerAddress.user_id == user.id)
                .order_by(CustomerAddress.created_at.desc())
            )
        ).all()
        if addresses:
            promoted = addresses[0]
            promoted.is_default = True
            session.add(promoted)
            await session.commit()


@router.get("/favourites", response_model=list[CustomerFavoriteItem])
async def list_favourites(
    user: User = Depends(require_role("customer")),
    session: AsyncSession = Depends(get_db),
) -> list[CustomerFavoriteItem]:
    rows = (
        await session.execute(
            select(CustomerFavorite, MenuItem)
            .join(MenuItem, MenuItem.id == CustomerFavorite.item_id)
            .where(CustomerFavorite.user_id == user.id, MenuItem.active.is_(True))
            .order_by(CustomerFavorite.created_at.desc())
        )
    ).all()
    return [
        CustomerFavoriteItem(
            item_id=item.id,
            name=item.name,
            photo_url=item.photo_url,
            price_inr=item.base_price_inr,
            is_veg=item.is_veg,
            created_at=favourite.created_at,
        )
        for favourite, item in rows
    ]


@router.put("/favourites/{item_id}", status_code=204)
async def add_favourite(
    item_id: UUID,
    user: User = Depends(require_role("customer")),
    session: AsyncSession = Depends(get_db),
) -> None:
    item = await session.get(MenuItem, item_id)
    if item is None or not item.active:
        raise HTTPException(status_code=404, detail="Menu item not found.")
    existing = await session.scalar(
        select(CustomerFavorite).where(
            CustomerFavorite.user_id == user.id,
            CustomerFavorite.item_id == item_id,
        )
    )
    if existing is None:
        session.add(CustomerFavorite(user_id=user.id, item_id=item_id))
        await session.commit()


@router.delete("/favourites/{item_id}", status_code=204)
async def remove_favourite(
    item_id: UUID,
    user: User = Depends(require_role("customer")),
    session: AsyncSession = Depends(get_db),
) -> None:
    await session.execute(
        delete(CustomerFavorite).where(
            CustomerFavorite.user_id == user.id,
            CustomerFavorite.item_id == item_id,
        )
    )
    await session.commit()


@router.delete("", status_code=204)
async def delete_me(
    user: User = Depends(require_role("customer")),
    session: AsyncSession = Depends(get_db),
) -> None:
    from app.services.privacy import anonymise_customer

    await anonymise_customer(session, user)
