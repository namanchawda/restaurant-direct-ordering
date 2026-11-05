from collections.abc import AsyncIterator

import bcrypt
import pytest
from sqlalchemy import func, literal, select, union_all
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
    User,
)
from app.seed import (
    ADDONS,
    CATEGORIES,
    DEMO_USERS,
    MENU_ITEMS,
    OUTLETS,
    SAMPLE_ORDERS,
    seed_data,
)

SEEDED_ITEM_NAMES = {
    "Chicken dum biryani",
    "Mutton dum biryani",
    "Veg biryani",
    "Egg biryani",
    "Chicken 65 biryani",
    "Mutton haleem",
    "Chicken haleem",
    "Chicken tikka",
    "Chicken 65",
    "Seekh kebab",
    "Paneer tikka",
    "Gobi 65",
    "Mirchi ka salan",
    "Butter chicken",
    "Bagara baingan",
    "Mutton dalcha",
    "Kadai paneer",
    "Rumali roti",
    "Tandoori roti",
    "Onion salad",
    "Raita",
    "Extra gravy",
    "Double ka meetha",
    "Qubani ka meetha",
    "Shahi tukda",
    "Irani chai",
    "Mango lassi",
    "Badam milk",
}


@pytest.fixture
async def session_factory() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_database_engine()
    try:
        yield async_sessionmaker(engine, expire_on_commit=False)
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_seeded_outlets_menu_orders_and_users(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        outlet_names = [outlet["name"] for outlet in OUTLETS]
        outlets = (
            await session.scalars(select(Outlet).where(Outlet.name.in_(outlet_names)))
        ).all()
        assert len(outlets) == 3

        items = (
            await session.scalars(
                select(MenuItem).where(MenuItem.name.in_(SEEDED_ITEM_NAMES))
            )
        ).all()
        assert len(items) >= 20

        expected_orders = {
            "WEB-778120": ("Kondapur", "preparing", "upi", 1180),
            "WEB-778131": ("Gachibowli cloud kitchen", "ready_for_pickup", "card", 640),
            "WEB-778146": ("Kukatpally", "preparing", "upi", 1050),
        }
        order_rows = (
            await session.execute(
                select(
                    Order.public_id,
                    Outlet.name,
                    Order.status,
                    Order.payment_method,
                    Order.total_inr,
                )
                .join(Outlet)
                .where(Order.public_id.in_(expected_orders))
            )
        ).all()
        assert {
            public_id: (outlet, status, payment, total)
            for public_id, outlet, status, payment, total in order_rows
        } == expected_orders

        expected_phones = {user["phone"] for user in DEMO_USERS}
        users = (
            await session.scalars(select(User).where(User.phone.in_(expected_phones)))
        ).all()
        assert len(users) == 5
        assert {user.phone: user.role for user in users} == {
            user["phone"]: user["role"] for user in DEMO_USERS
        }
        assert all(not user.marketing_opt_in for user in users)
        for demo_user in DEMO_USERS:
            user = next(user for user in users if user.phone == demo_user["phone"])
            if demo_user["password"]:
                assert user.password_hash is not None
                assert bcrypt.checkpw(
                    demo_user["password"].encode(), user.password_hash.encode()
                )


@pytest.mark.asyncio
async def test_sample_order_late_is_derived(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        order = await session.scalar(
            select(Order).where(Order.public_id == "WEB-778146")
        )
        assert order is not None
        assert order.status == "preparing"
        assert order.is_late


@pytest.mark.asyncio
async def test_seed_is_idempotent(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async def seeded_row_counts() -> dict[str, int]:
        async with session_factory() as session:
            outlet_names = [outlet["name"] for outlet in OUTLETS]
            category_names = [category["name"] for category in CATEGORIES]
            addon_names = [name for name, _ in ADDONS]
            order_ids = [order["public_id"] for order in SAMPLE_ORDERS]
            item_ids = select(MenuItem.id).where(MenuItem.name.in_(SEEDED_ITEM_NAMES))
            outlet_ids = select(Outlet.id).where(Outlet.name.in_(outlet_names))
            addon_ids = select(Addon.id).where(Addon.name.in_(addon_names))
            order_row_ids = select(Order.id).where(Order.public_id.in_(order_ids))

            count_queries = [
                select(literal("outlets"), func.count())
                .select_from(Outlet)
                .where(Outlet.name.in_(outlet_names)),
                select(literal("categories"), func.count())
                .select_from(Category)
                .where(Category.name.in_(category_names)),
                select(literal("menu_items"), func.count())
                .select_from(MenuItem)
                .where(MenuItem.name.in_(SEEDED_ITEM_NAMES)),
                select(literal("item_variants"), func.count())
                .select_from(ItemVariant)
                .where(ItemVariant.item_id.in_(item_ids)),
                select(literal("addons"), func.count())
                .select_from(Addon)
                .where(Addon.name.in_(addon_names)),
                select(literal("item_addons"), func.count())
                .select_from(ItemAddon)
                .where(ItemAddon.item_id.in_(item_ids)),
                select(literal("city_prices"), func.count())
                .select_from(CityPrice)
                .where(CityPrice.item_id.in_(item_ids))
                .where(CityPrice.city == "Hyderabad"),
                select(literal("outlet_item_availability"), func.count())
                .select_from(OutletItemAvailability)
                .where(OutletItemAvailability.item_id.in_(item_ids))
                .where(OutletItemAvailability.outlet_id.in_(outlet_ids)),
                select(literal("users"), func.count())
                .select_from(User)
                .where(User.phone.in_([user["phone"] for user in DEMO_USERS])),
                select(literal("orders"), func.count())
                .select_from(Order)
                .where(Order.public_id.in_(order_ids)),
                select(literal("order_items"), func.count())
                .select_from(OrderItem)
                .where(OrderItem.order_id.in_(order_row_ids)),
                select(literal("order_status_events"), func.count())
                .select_from(OrderStatusEvent)
                .where(OrderStatusEvent.order_id.in_(order_row_ids)),
            ]
            result = await session.execute(union_all(*count_queries))
            return {table_name: count for table_name, count in result.all()}

    async with session_factory() as session:
        await seed_data(session)
    first_counts = await seeded_row_counts()

    async with session_factory() as session:
        await seed_data(session)
    second_counts = await seeded_row_counts()

    assert first_counts == {
        "outlets": 3,
        "categories": len(CATEGORIES),
        "menu_items": len(MENU_ITEMS),
        "item_variants": 15,
        "addons": len(ADDONS),
        "item_addons": 29,
        "city_prices": len(MENU_ITEMS),
        "outlet_item_availability": len(OUTLETS) * len(MENU_ITEMS),
        "users": len(DEMO_USERS),
        "orders": len(SAMPLE_ORDERS),
        "order_items": 5,
        "order_status_events": len(SAMPLE_ORDERS) * 2,
    }
    assert second_counts == first_counts
