from collections import Counter

from sqlalchemy import CheckConstraint

from app.db.base import Base
from app.models import MenuItem, Order, Outlet, User
from app.seed import (
    CATEGORIES,
    DEMO_USERS,
    MENU_ITEMS,
    OUTLETS,
    PHOTO_URLS,
    SAMPLE_ORDERS,
)


def test_seed_defines_required_outlets_and_menu() -> None:
    assert len(OUTLETS) == 3
    assert {outlet["type"] for outlet in OUTLETS} == {"outlet", "cloud_kitchen"}
    assert all(len(outlet["fssai_number"]) == 14 for outlet in OUTLETS)
    assert len(MENU_ITEMS) >= 20
    assert {
        "Biryanis",
        "Haleem",
        "Kebabs and starters",
        "Curries",
        "Breads and sides",
        "Desserts",
        "Drinks",
    } == {category["name"] for category in CATEGORIES}
    assert any("available_from" in category for category in CATEGORIES)
    assert Counter(user["role"] for user in DEMO_USERS) == {
        "customer": 1,
        "kitchen": 3,
        "admin": 1,
    }
    assert set(PHOTO_URLS) == {item[0] for item in MENU_ITEMS}
    assert len(set(PHOTO_URLS.values())) == len(MENU_ITEMS)
    assert all(
        url.startswith("https://images.unsplash.com/photo-")
        and "w=1200" in url
        for url in PHOTO_URLS.values()
    )


def test_sample_order_totals_and_late_status_contract() -> None:
    assert [order["public_id"] for order in SAMPLE_ORDERS] == [
        "WEB-778120",
        "WEB-778131",
        "WEB-778146",
    ]
    assert [
        sum(item["unit_price_inr"] * item["quantity"] for item in order["items"])
        for order in SAMPLE_ORDERS
    ] == [order["total_inr"] for order in SAMPLE_ORDERS]
    late_order = next(order for order in SAMPLE_ORDERS if order["public_id"] == "WEB-778146")
    assert late_order["status"] == "preparing"
    assert late_order["minutes_until_promise"] == -4
    assert "late" not in Order.__table__.columns
    assert isinstance(Order.__dict__["is_late"], property)


def test_database_constraints_cover_roles_statuses_and_price_ranges() -> None:
    assert {"outlets", "categories", "menu_items", "item_variants", "addons", "riders",
            "item_addons", "city_prices", "outlet_item_availability", "users",
            "orders", "order_items", "order_status_events", "loyalty_accounts",
            "loyalty_transactions", "coupons", "coupon_redemptions"} == set(Base.metadata.tables)
    outlet_constraints = {
        constraint.name for constraint in Outlet.__table__.constraints
        if isinstance(constraint, CheckConstraint)
    }
    user_constraints = {
        constraint.name for constraint in User.__table__.constraints
        if isinstance(constraint, CheckConstraint)
    }
    item_constraints = {
        constraint.name for constraint in MenuItem.__table__.constraints
        if isinstance(constraint, CheckConstraint)
    }
    order_constraints = {
        constraint.name for constraint in Order.__table__.constraints
        if isinstance(constraint, CheckConstraint)
    }
    assert {"ck_outlets_type", "ck_outlets_min_prep"} <= outlet_constraints
    assert {"ck_users_role"} <= user_constraints
    assert {"ck_menu_items_spice_level", "ck_menu_items_base_price"} <= item_constraints
    assert {
        "ck_orders_status",
        "ck_orders_payment_method",
        "ck_orders_payment_status",
    } <= order_constraints
