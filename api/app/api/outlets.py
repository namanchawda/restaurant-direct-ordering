from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db
from app.models import Category, ItemAddon, MenuItem, Outlet
from app.services.geo import distance_km
from app.services.menu import category_window_status

router = APIRouter(tags=["outlets"])


@router.get("/outlets")
async def list_outlets(
    lat: float | None = Query(default=None, ge=-90, le=90),
    lng: float | None = Query(default=None, ge=-180, le=180),
    session: AsyncSession = Depends(get_db),
) -> list[dict[str, object]]:
    if (lat is None) != (lng is None):
        raise HTTPException(status_code=422, detail="Provide both lat and lng, or neither.")
    outlets = (await session.scalars(select(Outlet))).all()
    result = []
    for outlet in outlets:
        distance = (
            distance_km(lat, lng, outlet.lat, outlet.lng)
            if lat is not None and lng is not None
            else None
        )
        result.append(
            {
                "id": str(outlet.id),
                "name": outlet.name,
                "type": outlet.type,
                "city": outlet.city,
                "address": outlet.address,
                "lat": outlet.lat,
                "lng": outlet.lng,
                "delivery_radius_km": outlet.delivery_radius_km,
                "distance_km": round(distance, 2) if distance is not None else None,
                "is_inside_delivery_radius": (
                    distance <= outlet.delivery_radius_km if distance is not None else None
                ),
                "is_open": outlet.is_open,
                "fssai_number": outlet.fssai_number,
            }
        )
    if lat is not None and lng is not None:
        result.sort(key=lambda outlet: outlet["distance_km"])
    return result


@router.get("/outlets/{outlet_id}/menu")
async def outlet_menu(
    outlet_id: UUID, session: AsyncSession = Depends(get_db)
) -> dict[str, object]:
    outlet = await session.get(Outlet, outlet_id)
    if outlet is None:
        raise HTTPException(status_code=404, detail="Outlet not found.")
    categories = (
        await session.scalars(
            select(Category)
            .options(
                selectinload(Category.items).selectinload(MenuItem.variants),
                selectinload(Category.items).selectinload(MenuItem.city_prices),
                selectinload(Category.items)
                .selectinload(MenuItem.addon_links)
                .selectinload(ItemAddon.addon),
                selectinload(Category.items).selectinload(MenuItem.outlet_availability),
            )
            .order_by(Category.sort_order, Category.name)
        )
    ).all()
    now = datetime.now(UTC)
    result: list[dict[str, object]] = []
    for category in categories:
        available_now, window_text = category_window_status(category, now)
        items = []
        for item in sorted(category.items, key=lambda value: (value.sort_order, value.name)):
            if not item.active:
                continue
            availability = next(
                (record.available for record in item.outlet_availability if record.outlet_id == outlet.id),
                False,
            )
            city_price = next(
                (
                    price.price_inr
                    for price in item.city_prices
                    if price.city.casefold() == outlet.city.casefold()
                ),
                item.base_price_inr,
            )
            items.append(
                {
                    "id": str(item.id),
                    "name": item.name,
                    "description": item.description,
                    "photo_url": item.photo_url,
                    "is_veg": item.is_veg,
                    "spice_level": item.spice_level,
                    "allergens": item.allergens,
                    "price": city_price,
                    "available": availability and available_now and outlet.is_open,
                    "variants": [
                        {"id": str(variant.id), "name": variant.name, "price": variant.price_inr}
                        for variant in item.variants
                    ],
                    "addons": [
                        {
                            "id": str(link.addon.id),
                            "name": link.addon.name,
                            "price": link.addon.price_inr,
                        }
                        for link in item.addon_links
                    ],
                }
            )
        result.append(
            {
                "id": str(category.id),
                "name": category.name,
                "sort_order": category.sort_order,
                "available_now": available_now,
                "window_text": window_text,
                "items": items,
            }
        )
    return {
        "outlet": {
            "id": str(outlet.id),
            "name": outlet.name,
            "address": outlet.address,
            "is_open": outlet.is_open,
            "fssai_number": outlet.fssai_number,
            "type": outlet.type,
        },
        "price_note": "incl. 5% GST",
        "categories": result,
    }
