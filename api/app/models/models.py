from datetime import UTC, datetime, time
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Float,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class Outlet(TimestampMixin, Base):
    __tablename__ = "outlets"
    __table_args__ = (
        CheckConstraint("type IN ('outlet', 'cloud_kitchen')", name="ck_outlets_type"),
        CheckConstraint("delivery_radius_km > 0", name="ck_outlets_delivery_radius"),
        CheckConstraint("min_prep_minutes > 0", name="ck_outlets_min_prep"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    city: Mapped[str] = mapped_column(String(100), nullable=False)
    address: Mapped[str] = mapped_column(Text, nullable=False)
    lat: Mapped[float] = mapped_column(nullable=False)
    lng: Mapped[float] = mapped_column(nullable=False)
    delivery_radius_km: Mapped[int] = mapped_column(Integer, nullable=False)
    fssai_number: Mapped[str] = mapped_column(String(14), unique=True, nullable=False)
    is_open: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"), nullable=False)
    min_prep_minutes: Mapped[int] = mapped_column(Integer, nullable=False)

    users: Mapped[list["User"]] = relationship(back_populates="outlet")
    orders: Mapped[list["Order"]] = relationship(back_populates="outlet")
    item_availability: Mapped[list["OutletItemAvailability"]] = relationship(
        back_populates="outlet", cascade="all, delete-orphan"
    )


class Category(TimestampMixin, Base):
    __tablename__ = "categories"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    available_from: Mapped[time | None] = mapped_column(Time, nullable=True)
    available_to: Mapped[time | None] = mapped_column(Time, nullable=True)

    items: Mapped[list["MenuItem"]] = relationship(back_populates="category")


class MenuItem(TimestampMixin, Base):
    __tablename__ = "menu_items"
    __table_args__ = (
        CheckConstraint("spice_level BETWEEN 0 AND 3", name="ck_menu_items_spice_level"),
        CheckConstraint("base_price_inr >= 0", name="ck_menu_items_base_price"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    category_id: Mapped[UUID] = mapped_column(
        ForeignKey("categories.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    photo_url: Mapped[str] = mapped_column(Text, nullable=False)
    is_veg: Mapped[bool] = mapped_column(Boolean, nullable=False)
    spice_level: Mapped[int] = mapped_column(Integer, nullable=False)
    allergens: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list, nullable=False)
    base_price_inr: Mapped[int] = mapped_column(Integer, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    category: Mapped["Category"] = relationship(back_populates="items")
    variants: Mapped[list["ItemVariant"]] = relationship(
        back_populates="item", cascade="all, delete-orphan"
    )
    addon_links: Mapped[list["ItemAddon"]] = relationship(
        back_populates="item", cascade="all, delete-orphan"
    )
    city_prices: Mapped[list["CityPrice"]] = relationship(
        back_populates="item", cascade="all, delete-orphan"
    )
    outlet_availability: Mapped[list["OutletItemAvailability"]] = relationship(
        back_populates="item", cascade="all, delete-orphan"
    )


class ItemVariant(Base):
    __tablename__ = "item_variants"
    __table_args__ = (
        UniqueConstraint("item_id", "name", name="uq_item_variants_item_name"),
        CheckConstraint("price_inr >= 0", name="ck_item_variants_price"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    item_id: Mapped[UUID] = mapped_column(
        ForeignKey("menu_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    price_inr: Mapped[int] = mapped_column(Integer, nullable=False)

    item: Mapped["MenuItem"] = relationship(back_populates="variants")


class Addon(Base):
    __tablename__ = "addons"
    __table_args__ = (CheckConstraint("price_inr >= 0", name="ck_addons_price"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    price_inr: Mapped[int] = mapped_column(Integer, nullable=False)

    item_links: Mapped[list["ItemAddon"]] = relationship(
        back_populates="addon", cascade="all, delete-orphan"
    )


class ItemAddon(Base):
    __tablename__ = "item_addons"
    __table_args__ = (
        UniqueConstraint("item_id", "addon_id", name="uq_item_addons_item_addon"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    item_id: Mapped[UUID] = mapped_column(
        ForeignKey("menu_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    addon_id: Mapped[UUID] = mapped_column(
        ForeignKey("addons.id", ondelete="CASCADE"), nullable=False, index=True
    )

    item: Mapped["MenuItem"] = relationship(back_populates="addon_links")
    addon: Mapped["Addon"] = relationship(back_populates="item_links")


class CityPrice(Base):
    __tablename__ = "city_prices"
    __table_args__ = (
        UniqueConstraint("item_id", "city", name="uq_city_prices_item_city"),
        CheckConstraint("price_inr >= 0", name="ck_city_prices_price"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    item_id: Mapped[UUID] = mapped_column(
        ForeignKey("menu_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    city: Mapped[str] = mapped_column(String(100), nullable=False)
    price_inr: Mapped[int] = mapped_column(Integer, nullable=False)

    item: Mapped["MenuItem"] = relationship(back_populates="city_prices")


class OutletItemAvailability(Base):
    __tablename__ = "outlet_item_availability"
    __table_args__ = (
        UniqueConstraint("outlet_id", "item_id", name="uq_outlet_item_availability"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    outlet_id: Mapped[UUID] = mapped_column(
        ForeignKey("outlets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    item_id: Mapped[UUID] = mapped_column(
        ForeignKey("menu_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    available: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    outlet: Mapped["Outlet"] = relationship(back_populates="item_availability")
    item: Mapped["MenuItem"] = relationship(back_populates="outlet_availability")


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "role IN ('customer', 'kitchen', 'admin')", name="ck_users_role"
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    outlet_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("outlets.id", ondelete="SET NULL"), nullable=True, index=True
    )
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    marketing_opt_in: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    outlet: Mapped["Outlet | None"] = relationship(back_populates="users")
    orders: Mapped[list["Order"]] = relationship(back_populates="user")


class Order(TimestampMixin, Base):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint(
            "status IN ('placed', 'accepted', 'preparing', 'ready_for_pickup', "
            "'handed_to_rider', 'delivered', 'cancelled')",
            name="ck_orders_status",
        ),
        CheckConstraint("payment_method IN ('upi', 'card')", name="ck_orders_payment_method"),
        CheckConstraint(
            "payment_status IN ('pending', 'paid', 'failed', 'refunded')",
            name="ck_orders_payment_status",
        ),
        CheckConstraint("total_inr >= 0", name="ck_orders_total"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    public_id: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    outlet_id: Mapped[UUID] = mapped_column(
        ForeignKey("outlets.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    payment_method: Mapped[str] = mapped_column(String(16), nullable=False)
    payment_status: Mapped[str] = mapped_column(String(16), nullable=False)
    total_inr: Mapped[int] = mapped_column(Integer, nullable=False)
    delivery_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    delivery_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    delivery_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancellation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    placed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    promised_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ai_estimate_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    manager_override_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    outlet: Mapped["Outlet"] = relationship(back_populates="orders")
    user: Mapped["User"] = relationship(back_populates="orders")
    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )
    status_events: Mapped[list["OrderStatusEvent"]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="OrderStatusEvent.at",
    )

    @property
    def is_late(self) -> bool:
        return (
            self.status in {"placed", "accepted", "preparing"}
            and datetime.now(UTC) > self.promised_at
        )


class OrderItem(Base):
    __tablename__ = "order_items"
    __table_args__ = (
        CheckConstraint("unit_price_inr >= 0", name="ck_order_items_unit_price"),
        CheckConstraint("quantity > 0", name="ck_order_items_quantity"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    order_id: Mapped[UUID] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    item_id: Mapped[UUID] = mapped_column(
        ForeignKey("menu_items.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    variant_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("item_variants.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    unit_price_inr: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    addons: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON, default=list, server_default=text("'[]'"), nullable=False
    )

    order: Mapped["Order"] = relationship(back_populates="items")
    item: Mapped["MenuItem"] = relationship()
    variant: Mapped["ItemVariant | None"] = relationship()


class OrderStatusEvent(Base):
    __tablename__ = "order_status_events"
    __table_args__ = (
        CheckConstraint(
            "status IN ('placed', 'accepted', 'preparing', 'ready_for_pickup', "
            "'handed_to_rider', 'delivered', 'cancelled')",
            name="ck_order_status_events_status",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    order_id: Mapped[UUID] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    order: Mapped["Order"] = relationship(back_populates="status_events")
