from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_role
from app.models import Addon, Category, CityPrice, ItemAddon, ItemVariant, MenuItem, Outlet, OutletItemAvailability, User
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
)

router = APIRouter(prefix="/admin", tags=["admin"])


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
