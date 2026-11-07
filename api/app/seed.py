import asyncio
from datetime import UTC, datetime, time, timedelta
from typing import Any

import bcrypt
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.session import create_database_engine
from app.models import (
    Addon,
    Category,
    CityPrice,
    ItemAddon,
    ItemVariant,
    MenuItem,
    Order,
    OrderItem,
    OrderStatusEvent,
    Outlet,
    OutletItemAvailability,
    Rider,
    User,
)

CATEGORIES = [
    {"name": "Biryanis", "sort_order": 1, "prep_weight_minutes": 20},
    {"name": "Haleem", "sort_order": 2, "prep_weight_minutes": 20, "available_from": time(16), "available_to": time(23)},
    {"name": "Kebabs and starters", "sort_order": 3, "prep_weight_minutes": 15},
    {"name": "Curries", "sort_order": 4, "prep_weight_minutes": 15},
    {"name": "Breads and sides", "sort_order": 5, "prep_weight_minutes": 8},
    {"name": "Desserts", "sort_order": 6, "prep_weight_minutes": 5},
    {"name": "Drinks", "sort_order": 7, "prep_weight_minutes": 3},
]

OUTLETS = [
    {
        "name": "Kondapur",
        "type": "outlet",
        "city": "Hyderabad",
        "address": "Kondapur Main Road, Kondapur, Hyderabad, Telangana",
        "lat": 17.4649,
        "lng": 78.3639,
        "delivery_radius_km": 7,
        "fssai_number": "00000000000001",
        "is_open": True,
        "min_prep_minutes": 25,
        "kitchen_capacity": 18,
    },
    {
        "name": "Gachibowli cloud kitchen",
        "type": "cloud_kitchen",
        "city": "Hyderabad",
        "address": "Gachibowli, Serilingampally, Hyderabad, Telangana",
        "lat": 17.4401,
        "lng": 78.3489,
        "delivery_radius_km": 8,
        "fssai_number": "00000000000002",
        "is_open": True,
        "min_prep_minutes": 20,
        "kitchen_capacity": 30,
    },
    {
        "name": "Kukatpally",
        "type": "outlet",
        "city": "Hyderabad",
        "address": "KPHB Road, Kukatpally, Hyderabad, Telangana",
        "lat": 17.4849,
        "lng": 78.4138,
        "delivery_radius_km": 7,
        "fssai_number": "00000000000003",
        "is_open": True,
        "min_prep_minutes": 30,
        "kitchen_capacity": 18,
    },
]

PHOTO_URLS = {
    "Chicken dum biryani": "https://images.unsplash.com/photo-1589302168068-964664d93dc0?auto=format&fit=crop&w=1200&h=900&q=85",
    "Mutton dum biryani": "https://images.unsplash.com/photo-1633945274405-b6c8069047b0?auto=format&fit=crop&w=1200&h=900&q=85",
    "Veg biryani": "https://images.unsplash.com/photo-1596797038530-2c107229654b?auto=format&fit=crop&w=1200&h=900&q=85",
    "Egg biryani": "https://images.unsplash.com/photo-1565557623262-b51c2513a641?auto=format&fit=crop&w=1200&h=900&q=85",
    "Chicken 65 biryani": "https://images.unsplash.com/photo-1567337710282-00832b415979?auto=format&fit=crop&w=1200&h=900&q=85",
    "Mutton haleem": "https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=1200&h=900&q=85",
    "Chicken haleem": "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=1200&h=900&q=85",
    "Chicken tikka": "https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?auto=format&fit=crop&w=1200&h=900&q=85",
    "Chicken 65": "https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?auto=format&fit=crop&w=1200&h=900&q=85",
    "Seekh kebab": "https://images.unsplash.com/photo-1529042410759-befb1204b468?auto=format&fit=crop&w=1200&h=900&q=85",
    "Paneer tikka": "https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=1200&h=900&q=85",
    "Gobi 65": "https://images.unsplash.com/photo-1562967914-608f82629710?auto=format&fit=crop&w=1200&h=900&q=85",
    "Mirchi ka salan": "https://images.unsplash.com/photo-1574484284002-952d92456975?auto=format&fit=crop&w=1200&h=900&q=85",
    "Butter chicken": "https://images.unsplash.com/photo-1549931319-a545dcf3bc73?auto=format&fit=crop&w=1200&h=900&q=85",
    "Bagara baingan": "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=1200&h=900&q=85",
    "Mutton dalcha": "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=1200&h=900&q=85",
    "Kadai paneer": "https://images.unsplash.com/photo-1498837167922-ddd27525d352?auto=format&fit=crop&w=1200&h=900&q=85",
    "Rumali roti": "https://images.unsplash.com/photo-1589367920969-ab8e050bbb04?auto=format&fit=crop&w=1200&h=900&q=85",
    "Tandoori roti": "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=1200&h=900&q=85",
    "Onion salad": "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?auto=format&fit=crop&w=1200&h=900&q=85",
    "Raita": "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=1200&h=900&q=85",
    "Extra gravy": "https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?auto=format&fit=crop&w=1200&h=900&q=85",
    "Double ka meetha": "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=1200&h=900&q=85",
    "Qubani ka meetha": "https://images.unsplash.com/photo-1551024506-0bccd828d307?auto=format&fit=crop&w=1200&h=900&q=85",
    "Shahi tukda": "https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=1200&h=900&q=85",
    "Irani chai": "https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=1200&h=900&q=85",
    "Mango lassi": "https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=1200&h=900&q=85",
    "Badam milk": "https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=1200&h=900&q=85",
}

# Each price is an integer INR amount inclusive of 5% GST.
MENU_ITEMS = [
    ("Chicken dum biryani", "Biryanis", "Slow-cooked chicken, fragrant basmati and Hyderabadi spices.", False, 2, ["milk"], 380),
    ("Mutton dum biryani", "Biryanis", "Tender mutton layered with long-grain basmati rice.", False, 3, ["milk"], 460),
    ("Veg biryani", "Biryanis", "Seasonal vegetables and basmati rice, cooked dum-style.", True, 1, ["milk"], 250),
    ("Egg biryani", "Biryanis", "Spiced basmati rice with boiled eggs and herbs.", False, 2, ["egg"], 290),
    ("Chicken 65 biryani", "Biryanis", "Chicken 65 tossed with aromatic basmati rice.", False, 3, ["milk"], 410),
    ("Mutton haleem", "Haleem", "Slow-cooked mutton, lentils and wheat with warming spices.", False, 2, ["gluten", "milk"], 350),
    ("Chicken haleem", "Haleem", "Slow-cooked chicken, lentils and wheat with fresh herbs.", False, 1, ["gluten", "milk"], 300),
    ("Chicken tikka", "Kebabs and starters", "Char-grilled chicken marinated with house spices.", False, 2, ["milk"], 320),
    ("Chicken 65", "Kebabs and starters", "Crisp, tangy chicken bites finished with curry leaves.", False, 3, ["egg"], 280),
    ("Seekh kebab", "Kebabs and starters", "Minced lamb kebabs with coriander and green chilli.", False, 2, [], 340),
    ("Paneer tikka", "Kebabs and starters", "Char-grilled paneer with peppers and a spiced marinade.", True, 1, ["milk"], 290),
    ("Gobi 65", "Kebabs and starters", "Crisp cauliflower with curry leaves and chilli.", True, 2, ["gluten"], 220),
    ("Mirchi ka salan", "Curries", "Hyderabadi green chilli curry with sesame and peanut.", True, 2, ["nuts", "sesame"], 140),
    ("Butter chicken", "Curries", "Chicken in a gently spiced tomato and butter sauce.", False, 1, ["milk"], 360),
    ("Bagara baingan", "Curries", "Baby aubergines in a sesame, peanut and tamarind gravy.", True, 2, ["nuts", "sesame"], 240),
    ("Mutton dalcha", "Curries", "Mutton and lentils simmered with tamarind and spices.", False, 2, [], 320),
    ("Kadai paneer", "Curries", "Paneer, peppers and tomato with freshly ground spices.", True, 2, ["milk"], 300),
    ("Rumali roti", "Breads and sides", "Thin handkerchief bread, folded and served warm.", True, 0, ["gluten"], 35),
    ("Tandoori roti", "Breads and sides", "Whole-wheat flatbread baked in the tandoor.", True, 0, ["gluten"], 30),
    ("Onion salad", "Breads and sides", "Fresh onion, lemon and herbs.", True, 0, [], 45),
    ("Raita", "Breads and sides", "Cooling yoghurt with cucumber and roasted cumin.", True, 0, ["milk"], 70),
    ("Extra gravy", "Breads and sides", "A serving of the day's house curry gravy.", True, 1, [], 60),
    ("Double ka meetha", "Desserts", "Hyderabadi bread pudding with saffron and nuts.", True, 0, ["gluten", "milk", "nuts"], 100),
    ("Qubani ka meetha", "Desserts", "Slow-cooked apricots served with a little cream.", True, 0, ["milk", "nuts"], 130),
    ("Shahi tukda", "Desserts", "Crisp bread, saffron milk and a touch of cardamom.", True, 0, ["gluten", "milk", "nuts"], 120),
    ("Irani chai", "Drinks", "Hyderabadi-style slow-brewed tea with milk.", True, 0, ["milk"], 60),
    ("Mango lassi", "Drinks", "Chilled yoghurt drink blended with mango.", True, 0, ["milk"], 110),
    ("Badam milk", "Drinks", "Chilled milk with almonds and cardamom.", True, 0, ["milk", "nuts"], 100),
]

ADDONS = [
    ("Raita", 50),
    ("Extra gravy", 60),
    ("Boiled egg", 30),
    ("Mirchi ka salan", 100),
    ("Extra naan", 45),
]

ITEM_ADDONS = {
    "Chicken dum biryani": ["Raita", "Extra gravy", "Boiled egg", "Mirchi ka salan"],
    "Mutton dum biryani": ["Raita", "Extra gravy", "Mirchi ka salan"],
    "Veg biryani": ["Raita", "Extra gravy", "Mirchi ka salan"],
    "Egg biryani": ["Raita", "Extra gravy", "Boiled egg"],
    "Chicken 65 biryani": ["Raita", "Extra gravy", "Boiled egg"],
    "Mutton haleem": ["Boiled egg", "Extra naan"],
    "Chicken haleem": ["Boiled egg", "Extra naan"],
    "Chicken tikka": ["Raita", "Extra naan"],
    "Paneer tikka": ["Raita", "Extra naan"],
    "Mirchi ka salan": ["Extra naan"],
    "Butter chicken": ["Extra naan"],
    "Bagara baingan": ["Extra naan"],
    "Mutton dalcha": ["Extra naan"],
    "Kadai paneer": ["Extra naan"],
}

DEMO_USERS = [
    {"name": "Demo Customer", "phone": "9000000001", "role": "customer", "outlet": None, "password": None, "marketing_opt_in": False},
    {"name": "Kondapur Kitchen", "phone": "9000000011", "role": "kitchen", "outlet": "Kondapur", "password": "KondapurKitchen!2026", "marketing_opt_in": False},
    {"name": "Gachibowli Kitchen", "phone": "9000000012", "role": "kitchen", "outlet": "Gachibowli cloud kitchen", "password": "GachibowliKitchen!2026", "marketing_opt_in": False},
    {"name": "Kukatpally Kitchen", "phone": "9000000013", "role": "kitchen", "outlet": "Kukatpally", "password": "KukatpallyKitchen!2026", "marketing_opt_in": False},
    {"name": "Demo Admin", "phone": "9000000099", "role": "admin", "outlet": None, "password": "DemoAdmin!2026", "marketing_opt_in": False},
]

RIDERS = [
    {"name": "Ravi", "vehicle_number": "TS 09 AB 1201", "rating": 4.8, "masked_phone": "98XXXXX210"},
    {"name": "Imran", "vehicle_number": "TS 08 CD 4420", "rating": 4.7, "masked_phone": "98XXXXX321"},
    {"name": "Suresh", "vehicle_number": "TS 10 EF 7614", "rating": 4.9, "masked_phone": "98XXXXX432"},
    {"name": "Kiran", "vehicle_number": "TS 09 GH 8830", "rating": 4.6, "masked_phone": "98XXXXX543"},
    {"name": "Naveen", "vehicle_number": "TS 07 JK 1145", "rating": 4.8, "masked_phone": "98XXXXX654"},
    {"name": "Arjun", "vehicle_number": "TS 11 LM 2290", "rating": 4.5, "masked_phone": "98XXXXX765"},
    {"name": "Faiz", "vehicle_number": "TS 12 NP 3371", "rating": 4.7, "masked_phone": "98XXXXX876"},
    {"name": "Vikram", "vehicle_number": "TS 13 QR 4482", "rating": 4.9, "masked_phone": "98XXXXX987"},
]

SAMPLE_ORDERS = [
    {
        "public_id": "WEB-778120",
        "outlet": "Kondapur",
        "total_inr": 1180,
        "payment_method": "upi",
        "payment_status": "paid",
        "status": "preparing",
        "minutes_ago": 18,
        "minutes_until_promise": 27,
        "items": [
            {"item": "Chicken dum biryani", "variant": "Family pack", "name": "Chicken dum biryani - Family pack", "unit_price_inr": 980, "quantity": 1, "addons": []},
            {"item": "Double ka meetha", "variant": None, "name": "Double ka meetha", "unit_price_inr": 100, "quantity": 2, "addons": []},
        ],
    },
    {
        "public_id": "WEB-778131",
        "outlet": "Gachibowli cloud kitchen",
        "total_inr": 640,
        "payment_method": "card",
        "payment_status": "paid",
        "status": "ready_for_pickup",
        "minutes_ago": 9,
        "minutes_until_promise": 31,
        "items": [
            {"item": "Veg biryani", "variant": None, "name": "Veg biryani", "unit_price_inr": 250, "quantity": 2, "addons": []},
            {"item": "Mirchi ka salan", "variant": None, "name": "Mirchi ka salan", "unit_price_inr": 140, "quantity": 1, "addons": []},
        ],
    },
    {
        "public_id": "WEB-778146",
        "outlet": "Kukatpally",
        "total_inr": 1050,
        "payment_method": "upi",
        "payment_status": "paid",
        "status": "preparing",
        "minutes_ago": 65,
        "minutes_until_promise": -4,
        "items": [
            {"item": "Mutton haleem", "variant": None, "name": "Mutton haleem", "unit_price_inr": 350, "quantity": 3, "addons": []},
        ],
    },
]


def _upsert(
    session: AsyncSession,
    existing: dict[Any, Any],
    key: Any,
    model: type[Any],
    values: dict[str, Any],
) -> Any:
    instance = existing.get(key)
    if instance is None:
        instance = model(**values)
        session.add(instance)
    else:
        for field, value in values.items():
            setattr(instance, field, value)
    existing[key] = instance
    return instance


async def seed_data(session: AsyncSession) -> None:
    async with session.begin():
        riders = {rider.name: rider for rider in (await session.scalars(select(Rider))).all()}
        for data in RIDERS:
            _upsert(session, riders, data["name"], Rider, {**data, "is_available": True})
        await session.flush()
        outlet_names = [data["name"] for data in OUTLETS]
        outlets = {
            outlet.name: outlet
            for outlet in (
                await session.scalars(
                    select(Outlet).where(Outlet.name.in_(outlet_names))
                )
            ).all()
        }
        for data in OUTLETS:
            _upsert(session, outlets, data["name"], Outlet, data)
        await session.flush()

        category_names = [data["name"] for data in CATEGORIES]
        categories = {
            category.name: category
            for category in (
                await session.scalars(
                    select(Category).where(Category.name.in_(category_names))
                )
            ).all()
        }
        for data in CATEGORIES:
            _upsert(session, categories, data["name"], Category, data)
        await session.flush()

        addon_names = [name for name, _ in ADDONS]
        addons = {
            addon.name: addon
            for addon in (
                await session.scalars(
                    select(Addon).where(Addon.name.in_(addon_names))
                )
            ).all()
        }
        for name, price in ADDONS:
            _upsert(session, addons, name, Addon, {"name": name, "price_inr": price})

        item_names = [data[0] for data in MENU_ITEMS]
        menu_items = {
            item.name: item
            for item in (
                await session.scalars(
                    select(MenuItem).where(MenuItem.name.in_(item_names))
                )
            ).all()
        }
        for sort_order, (
            name,
            category_name,
            description,
            is_veg,
            spice_level,
            allergens,
            price,
        ) in enumerate(MENU_ITEMS, start=1):
            _upsert(
                session,
                menu_items,
                name,
                MenuItem,
                {
                    "name": name,
                    "category_id": categories[category_name].id,
                    "description": description,
                    "photo_url": PHOTO_URLS[name],
                    "is_veg": is_veg,
                    "spice_level": spice_level,
                    "allergens": allergens,
                    "base_price_inr": price,
                    "active": True,
                    "sort_order": sort_order,
                },
            )
        await session.flush()

        biryani_variants = {
            "Chicken dum biryani": [("Half", 220), ("Full", 380), ("Family pack", 980)],
            "Mutton dum biryani": [("Half", 270), ("Full", 460), ("Family pack", 1180)],
            "Veg biryani": [("Half", 150), ("Full", 250), ("Family pack", 650)],
            "Egg biryani": [("Half", 180), ("Full", 290), ("Family pack", 760)],
            "Chicken 65 biryani": [("Half", 240), ("Full", 410), ("Family pack", 1080)],
        }
        variant_specs = [
            (menu_items[item_name].id, item_name, name, price)
            for item_name, variants in biryani_variants.items()
            for name, price in variants
        ]
        item_ids = [item.id for item in menu_items.values()]
        variants = {
            (variant.item_id, variant.name): variant
            for variant in (
                await session.scalars(
                    select(ItemVariant).where(ItemVariant.item_id.in_(item_ids))
                )
            ).all()
        }
        for item_id, _, name, price in variant_specs:
            _upsert(
                session,
                variants,
                (item_id, name),
                ItemVariant,
                {"item_id": item_id, "name": name, "price_inr": price},
            )
        await session.flush()

        addon_links = {
            (link.item_id, link.addon_id): link
            for link in (
                await session.scalars(
                    select(ItemAddon).where(ItemAddon.item_id.in_(item_ids))
                )
            ).all()
        }
        for item_name, addon_names in ITEM_ADDONS.items():
            for addon_name in addon_names:
                key = (menu_items[item_name].id, addons[addon_name].id)
                _upsert(
                    session,
                    addon_links,
                    key,
                    ItemAddon,
                    {
                        "item_id": menu_items[item_name].id,
                        "addon_id": addons[addon_name].id,
                    },
                )

        city_prices = {
            price.item_id: price
            for price in (
                await session.scalars(
                    select(CityPrice)
                    .where(CityPrice.item_id.in_(item_ids))
                    .where(CityPrice.city == "Hyderabad")
                )
            ).all()
        }
        for item_name, item in menu_items.items():
            _upsert(
                session,
                city_prices,
                item.id,
                CityPrice,
                {"item_id": item.id, "city": "Hyderabad", "price_inr": item.base_price_inr},
            )

        outlet_ids = [outlet.id for outlet in outlets.values()]
        availability = {
            (record.outlet_id, record.item_id): record
            for record in (
                await session.scalars(
                    select(OutletItemAvailability)
                    .where(OutletItemAvailability.outlet_id.in_(outlet_ids))
                    .where(OutletItemAvailability.item_id.in_(item_ids))
                )
            ).all()
        }
        for item_name, item in menu_items.items():
            for outlet in outlets.values():
                available = not (
                    outlet.name == "Kondapur"
                    and item_name in {"Gobi 65", "Qubani ka meetha"}
                )
                key = (outlet.id, item.id)
                _upsert(
                    session,
                    availability,
                    key,
                    OutletItemAvailability,
                    {"outlet_id": outlet.id, "item_id": item.id, "available": available},
                )

        phones = [data["phone"] for data in DEMO_USERS]
        users = {
            user.phone: user
            for user in (
                await session.scalars(select(User).where(User.phone.in_(phones)))
            ).all()
        }
        for data in DEMO_USERS:
            outlet = outlets[data["outlet"]] if data["outlet"] else None
            user = users.get(data["phone"])
            if user is None:
                password_hash = (
                    bcrypt.hashpw(
                        data["password"].encode(), bcrypt.gensalt()
                    ).decode()
                    if data["password"]
                    else None
                )
                user = _upsert(
                    session,
                    users,
                    data["phone"],
                    User,
                    {
                        "name": data["name"],
                        "phone": data["phone"],
                        "role": data["role"],
                        "outlet_id": outlet.id if outlet else None,
                        "password_hash": password_hash,
                        "marketing_opt_in": data["marketing_opt_in"],
                    },
                )
            else:
                user.name = data["name"]
                user.role = data["role"]
                user.outlet_id = outlet.id if outlet else None
                user.marketing_opt_in = data["marketing_opt_in"]
            if user.password_hash is None and data["password"]:
                user.password_hash = bcrypt.hashpw(
                    data["password"].encode(), bcrypt.gensalt()
                ).decode()
        await session.flush()

        now = datetime.now(UTC)
        customer = users["9000000001"]
        order_ids = [sample["public_id"] for sample in SAMPLE_ORDERS]
        orders = {
            order.public_id: order
            for order in (
                await session.scalars(
                    select(Order).where(Order.public_id.in_(order_ids))
                )
            ).all()
        }
        for sample in SAMPLE_ORDERS:
            outlet = outlets[sample["outlet"]]
            placed_at = now - timedelta(minutes=sample["minutes_ago"])
            promised_at = now + timedelta(minutes=sample["minutes_until_promise"])
            order = _upsert(
                session,
                orders,
                sample["public_id"],
                Order,
                {
                    "public_id": sample["public_id"],
                    "outlet_id": outlet.id,
                    "user_id": customer.id,
                    "status": sample["status"],
                    "payment_method": sample["payment_method"],
                    "payment_status": sample["payment_status"],
                    "total_inr": sample["total_inr"],
                    "placed_at": placed_at,
                    "promised_at": promised_at,
                    "ai_estimate_minutes": None,
                    "manager_override_minutes": None,
                },
            )
        await session.flush()
        order_row_ids = [order.id for order in orders.values()]
        await session.execute(
            delete(OrderItem).where(OrderItem.order_id.in_(order_row_ids))
        )
        await session.execute(
            delete(OrderStatusEvent).where(OrderStatusEvent.order_id.in_(order_row_ids))
        )

        for sample in SAMPLE_ORDERS:
            order = orders[sample["public_id"]]
            placed_at = order.placed_at
            status_time = datetime.now(UTC) - timedelta(
                minutes=max(sample["minutes_ago"] // 2, 1)
            )
            for snapshot in sample["items"]:
                item = menu_items[snapshot["item"]]
                variant = (
                    variants.get((item.id, snapshot["variant"]))
                    if snapshot["variant"]
                    else None
                )
                session.add(
                    OrderItem(
                        order_id=order.id,
                        item_id=item.id,
                        variant_id=variant.id if variant else None,
                        name=snapshot["name"],
                        unit_price_inr=snapshot["unit_price_inr"],
                        quantity=snapshot["quantity"],
                        addons=snapshot["addons"],
                    )
                )
            session.add_all(
                [
                    OrderStatusEvent(
                        order_id=order.id, status="placed", at=placed_at
                    ),
                    OrderStatusEvent(
                        order_id=order.id, status=sample["status"], at=status_time
                    ),
                ]
            )

    print(
        f"Seeded {len(OUTLETS)} outlets, {len(MENU_ITEMS)} menu items, "
        f"{len(DEMO_USERS)} demo users, {len(RIDERS)} fictional riders, and {len(SAMPLE_ORDERS)} sample orders."
    )


async def main() -> None:
    engine = create_database_engine()
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with session_factory() as session:
            await seed_data(session)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
