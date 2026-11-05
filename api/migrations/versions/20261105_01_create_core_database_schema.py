"""Create the Core-build database schema.

Revision ID: 20261105_01
Revises:
Create Date: 2026-11-05
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20261105_01"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "outlets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("city", sa.String(length=100), nullable=False),
        sa.Column("address", sa.Text(), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("delivery_radius_km", sa.Integer(), nullable=False),
        sa.Column("fssai_number", sa.String(length=14), nullable=False),
        sa.Column("is_open", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("min_prep_minutes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("type IN ('outlet', 'cloud_kitchen')", name="ck_outlets_type"),
        sa.CheckConstraint("delivery_radius_km > 0", name="ck_outlets_delivery_radius"),
        sa.CheckConstraint("min_prep_minutes > 0", name="ck_outlets_min_prep"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
        sa.UniqueConstraint("fssai_number"),
    )
    op.create_table(
        "categories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("available_from", sa.Time(), nullable=True),
        sa.Column("available_to", sa.Time(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "addons",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("price_inr", sa.Integer(), nullable=False),
        sa.CheckConstraint("price_inr >= 0", name="ck_addons_price"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "menu_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("photo_url", sa.Text(), nullable=False),
        sa.Column("is_veg", sa.Boolean(), nullable=False),
        sa.Column("spice_level", sa.Integer(), nullable=False),
        sa.Column("allergens", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("base_price_inr", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("spice_level BETWEEN 0 AND 3", name="ck_menu_items_spice_level"),
        sa.CheckConstraint("base_price_inr >= 0", name="ck_menu_items_base_price"),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index("ix_menu_items_category_id", "menu_items", ["category_id"])
    op.create_table(
        "item_variants",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("item_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("price_inr", sa.Integer(), nullable=False),
        sa.CheckConstraint("price_inr >= 0", name="ck_item_variants_price"),
        sa.ForeignKeyConstraint(["item_id"], ["menu_items.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("item_id", "name", name="uq_item_variants_item_name"),
    )
    op.create_index("ix_item_variants_item_id", "item_variants", ["item_id"])
    op.create_table(
        "item_addons",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("item_id", sa.Uuid(), nullable=False),
        sa.Column("addon_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["addon_id"], ["addons.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["item_id"], ["menu_items.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("item_id", "addon_id", name="uq_item_addons_item_addon"),
    )
    op.create_index("ix_item_addons_addon_id", "item_addons", ["addon_id"])
    op.create_index("ix_item_addons_item_id", "item_addons", ["item_id"])
    op.create_table(
        "city_prices",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("item_id", sa.Uuid(), nullable=False),
        sa.Column("city", sa.String(length=100), nullable=False),
        sa.Column("price_inr", sa.Integer(), nullable=False),
        sa.CheckConstraint("price_inr >= 0", name="ck_city_prices_price"),
        sa.ForeignKeyConstraint(["item_id"], ["menu_items.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("item_id", "city", name="uq_city_prices_item_city"),
    )
    op.create_index("ix_city_prices_item_id", "city_prices", ["item_id"])
    op.create_table(
        "outlet_item_availability",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("outlet_id", sa.Uuid(), nullable=False),
        sa.Column("item_id", sa.Uuid(), nullable=False),
        sa.Column("available", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["item_id"], ["menu_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["outlet_id"], ["outlets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("outlet_id", "item_id", name="uq_outlet_item_availability"),
    )
    op.create_index(
        "ix_outlet_item_availability_item_id", "outlet_item_availability", ["item_id"]
    )
    op.create_index(
        "ix_outlet_item_availability_outlet_id", "outlet_item_availability", ["outlet_id"]
    )
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("phone", sa.String(length=20), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("outlet_id", sa.Uuid(), nullable=True),
        sa.Column("password_hash", sa.String(length=255), nullable=True),
        sa.Column("marketing_opt_in", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("role IN ('customer', 'kitchen', 'admin')", name="ck_users_role"),
        sa.ForeignKeyConstraint(["outlet_id"], ["outlets.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("phone"),
    )
    op.create_index("ix_users_outlet_id", "users", ["outlet_id"])
    op.create_table(
        "orders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("public_id", sa.String(length=32), nullable=False),
        sa.Column("outlet_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("payment_method", sa.String(length=16), nullable=False),
        sa.Column("payment_status", sa.String(length=16), nullable=False),
        sa.Column("total_inr", sa.Integer(), nullable=False),
        sa.Column("placed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("promised_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ai_estimate_minutes", sa.Integer(), nullable=True),
        sa.Column("manager_override_minutes", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "status IN ('placed', 'accepted', 'preparing', 'ready_for_pickup', "
            "'handed_to_rider', 'delivered', 'cancelled')",
            name="ck_orders_status",
        ),
        sa.CheckConstraint("payment_method IN ('upi', 'card')", name="ck_orders_payment_method"),
        sa.CheckConstraint(
            "payment_status IN ('pending', 'paid', 'failed', 'refunded')",
            name="ck_orders_payment_status",
        ),
        sa.CheckConstraint("total_inr >= 0", name="ck_orders_total"),
        sa.ForeignKeyConstraint(["outlet_id"], ["outlets.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id"),
    )
    op.create_index("ix_orders_outlet_id", "orders", ["outlet_id"])
    op.create_index("ix_orders_user_id", "orders", ["user_id"])
    op.create_table(
        "order_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("item_id", sa.Uuid(), nullable=False),
        sa.Column("variant_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("unit_price_inr", sa.Integer(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("addons", sa.JSON(), server_default=sa.text("'[]'"), nullable=False),
        sa.CheckConstraint("unit_price_inr >= 0", name="ck_order_items_unit_price"),
        sa.CheckConstraint("quantity > 0", name="ck_order_items_quantity"),
        sa.ForeignKeyConstraint(["item_id"], ["menu_items.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["variant_id"], ["item_variants.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_order_items_item_id", "order_items", ["item_id"])
    op.create_index("ix_order_items_order_id", "order_items", ["order_id"])
    op.create_table(
        "order_status_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('placed', 'accepted', 'preparing', 'ready_for_pickup', "
            "'handed_to_rider', 'delivered', 'cancelled')",
            name="ck_order_status_events_status",
        ),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_order_status_events_order_id", "order_status_events", ["order_id"])


def downgrade() -> None:
    op.drop_index("ix_order_status_events_order_id", table_name="order_status_events")
    op.drop_table("order_status_events")
    op.drop_index("ix_order_items_order_id", table_name="order_items")
    op.drop_index("ix_order_items_item_id", table_name="order_items")
    op.drop_table("order_items")
    op.drop_index("ix_orders_user_id", table_name="orders")
    op.drop_index("ix_orders_outlet_id", table_name="orders")
    op.drop_table("orders")
    op.drop_index("ix_users_outlet_id", table_name="users")
    op.drop_table("users")
    op.drop_index(
        "ix_outlet_item_availability_outlet_id", table_name="outlet_item_availability"
    )
    op.drop_index(
        "ix_outlet_item_availability_item_id", table_name="outlet_item_availability"
    )
    op.drop_table("outlet_item_availability")
    op.drop_index("ix_city_prices_item_id", table_name="city_prices")
    op.drop_table("city_prices")
    op.drop_index("ix_item_addons_item_id", table_name="item_addons")
    op.drop_index("ix_item_addons_addon_id", table_name="item_addons")
    op.drop_table("item_addons")
    op.drop_index("ix_item_variants_item_id", table_name="item_variants")
    op.drop_table("item_variants")
    op.drop_index("ix_menu_items_category_id", table_name="menu_items")
    op.drop_table("menu_items")
    op.drop_table("addons")
    op.drop_table("categories")
    op.drop_table("outlets")
