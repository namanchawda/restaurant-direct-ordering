from datetime import date, datetime, time
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ALLERGENS = {"milk", "gluten", "nuts", "egg", "fish", "shellfish", "soy", "sesame"}


class APIModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OTPRequest(APIModel):
    phone: Annotated[str, Field(min_length=8, max_length=20)]


class OTPVerify(OTPRequest):
    otp: Annotated[str, Field(min_length=4, max_length=12)]
    name: Annotated[str | None, Field(default=None, min_length=1, max_length=160)]
    marketing_opt_in: bool = False


class LoginRequest(OTPRequest):
    password: Annotated[str, Field(min_length=1, max_length=128)]


class DeliveryAddress(APIModel):
    address: Annotated[str, Field(min_length=5, max_length=500)]
    lat: Annotated[float, Field(ge=-90, le=90)]
    lng: Annotated[float, Field(ge=-180, le=180)]


class OrderLineInput(APIModel):
    item_id: UUID
    variant_id: UUID | None = None
    addon_ids: list[UUID] = Field(default_factory=list)
    quantity: Annotated[int, Field(ge=1, le=20)]
    # Legacy client fields are accepted for compatibility and deliberately ignored by pricing.
    price: int | None = None
    price_inr: int | None = None


class OrderCreate(APIModel):
    outlet_id: UUID
    items: Annotated[list[OrderLineInput], Field(min_length=1)]
    payment_method: Literal["upi", "card"]
    delivery_address: DeliveryAddress
    phone: Annotated[str, Field(min_length=8, max_length=20)]
    notes: Annotated[str | None, Field(default=None, max_length=1000)]
    redeem_points: Annotated[int, Field(default=0, ge=0)] = 0
    coupon_code: Annotated[str | None, Field(default=None, max_length=40)] = None


class OrderQuote(APIModel):
    outlet_id: UUID
    items: Annotated[list[OrderLineInput], Field(min_length=1)]
    redeem_points: Annotated[int, Field(default=0, ge=0)] = 0
    coupon_code: Annotated[str | None, Field(default=None, max_length=40)] = None
    user_id: UUID | None = None


class CouponValidate(APIModel):
    code: Annotated[str, Field(min_length=1, max_length=40)]
    outlet_id: UUID
    items: Annotated[list[OrderLineInput], Field(min_length=1)]


class CouponEligible(APIModel):
    outlet_id: UUID
    items: Annotated[list[OrderLineInput], Field(min_length=1)]


class CouponCreate(APIModel):
    code: Annotated[str, Field(min_length=2, max_length=40)]
    type: Literal["percent", "flat"]
    value: Annotated[int, Field(gt=0)]
    min_order_inr: Annotated[int, Field(ge=0)] = 0
    max_discount_inr: Annotated[int | None, Field(default=None, ge=0)] = None
    valid_from: datetime | None = None
    valid_to: datetime | None = None
    usage_limit_total: Annotated[int | None, Field(default=None, gt=0)] = None
    usage_limit_per_user: Annotated[int | None, Field(default=None, gt=0)] = None
    first_order_only: bool = False
    active: bool = True


class CouponUpdate(APIModel):
    active: bool | None = None
    value: Annotated[int | None, Field(default=None, gt=0)] = None
    min_order_inr: Annotated[int | None, Field(default=None, ge=0)] = None


class PaymentRequest(APIModel):
    upi_id: Annotated[str | None, Field(default=None, max_length=120)]
    card_number: Annotated[str | None, Field(default=None, max_length=32)]


class CancelRequest(APIModel):
    reason: Annotated[str, Field(min_length=1, max_length=500)]


class StatusUpdate(APIModel):
    status: Literal[
        "accepted",
        "preparing",
        "ready_for_pickup",
        "handed_to_rider",
        "delivered",
        "cancelled",
    ]
    reason: Annotated[str | None, Field(default=None, max_length=500)]

    @model_validator(mode="after")
    def require_cancel_reason(self):
        if self.status == "cancelled" and not self.reason:
            raise ValueError("A cancellation reason is required.")
        if self.status != "cancelled" and self.reason is not None:
            raise ValueError("A reason is only accepted when cancelling an order.")
        return self


class PartyOrderItemInput(APIModel):
    item_id: UUID
    variant_id: UUID | None = None
    quantity: Annotated[int, Field(ge=1, le=500)]


class PartyOrderCreate(APIModel):
    outlet_id: UUID
    event_date: date
    event_time: time
    guests: Annotated[int, Field(ge=1, le=500)]
    delivery_or_pickup: Literal["delivery", "pickup"]
    address: Annotated[str | None, Field(default=None, min_length=5, max_length=500)] = None
    contact_name: Annotated[str, Field(min_length=1, max_length=160)]
    contact_phone: Annotated[str, Field(min_length=8, max_length=20)]
    notes: Annotated[str | None, Field(default=None, max_length=2000)] = None
    items: Annotated[list[PartyOrderItemInput], Field(min_length=1)]

    @model_validator(mode="after")
    def validate_address(self):
        if self.delivery_or_pickup == "delivery" and not self.address:
            raise ValueError("A delivery address is required for party delivery.")
        return self


class PartyQuoteRequest(APIModel):
    outlet_id: UUID
    items: Annotated[list[PartyOrderItemInput], Field(min_length=1)]


class PartyConfirmRequest(APIModel):
    manager_note: Annotated[str | None, Field(default=None, max_length=2000)] = None
    adjusted_total_inr: Annotated[int | None, Field(default=None, ge=0)] = None


class PartyRejectRequest(APIModel):
    reason: Annotated[str, Field(min_length=1, max_length=2000)]


class OverrideUpdate(APIModel):
    minutes: Annotated[int, Field(gt=0, le=240)]


class AvailabilityUpdate(APIModel):
    available: bool


class CategoryCreate(APIModel):
    name: Annotated[str, Field(min_length=1, max_length=120)]
    sort_order: int = 0
    available_from: time | None = None
    available_to: time | None = None


class CategoryUpdate(APIModel):
    name: Annotated[str | None, Field(default=None, min_length=1, max_length=120)]
    sort_order: int | None = None
    available_from: time | None = None
    available_to: time | None = None


class VariantInput(APIModel):
    id: UUID | None = None
    name: Annotated[str, Field(min_length=1, max_length=100)]
    price_inr: Annotated[int, Field(gt=0)]


class MenuItemCreate(APIModel):
    category_id: UUID
    name: Annotated[str, Field(min_length=1, max_length=160)]
    description: str
    photo_url: str
    is_veg: bool
    spice_level: Annotated[int, Field(ge=0, le=3)]
    allergens: list[str] = Field(default_factory=list)
    base_price_inr: Annotated[int, Field(gt=0)]
    active: bool = True
    sort_order: int = 0
    variants: list[VariantInput] = Field(default_factory=list)
    addon_ids: list[UUID] = Field(default_factory=list)

    @field_validator("allergens")
    @classmethod
    def validate_allergens(cls, value: list[str]) -> list[str]:
        invalid = set(value) - ALLERGENS
        if invalid:
            raise ValueError(f"Unsupported allergens: {', '.join(sorted(invalid))}.")
        return value


class MenuItemUpdate(APIModel):
    category_id: UUID | None = None
    name: Annotated[str | None, Field(default=None, min_length=1, max_length=160)]
    description: str | None = None
    photo_url: str | None = None
    is_veg: bool | None = None
    spice_level: Annotated[int | None, Field(default=None, ge=0, le=3)]
    allergens: list[str] | None = None
    base_price_inr: Annotated[int | None, Field(default=None, gt=0)]
    active: bool | None = None
    sort_order: int | None = None
    variants: list[VariantInput] | None = None
    addon_ids: list[UUID] | None = None

    @field_validator("allergens")
    @classmethod
    def validate_allergens(cls, value: list[str] | None) -> list[str] | None:
        if value is not None:
            invalid = set(value) - ALLERGENS
            if invalid:
                raise ValueError(f"Unsupported allergens: {', '.join(sorted(invalid))}.")
        return value


class AddonCreate(APIModel):
    name: Annotated[str, Field(min_length=1, max_length=120)]
    price_inr: Annotated[int, Field(gt=0)]


class AddonUpdate(APIModel):
    name: Annotated[str | None, Field(default=None, min_length=1, max_length=120)]
    price_inr: Annotated[int | None, Field(default=None, gt=0)]


class CityPriceCreate(APIModel):
    item_id: UUID
    city: Annotated[str, Field(min_length=1, max_length=100)]
    price_inr: Annotated[int, Field(gt=0)]


class CityPriceUpdate(APIModel):
    item_id: UUID | None = None
    city: Annotated[str | None, Field(default=None, min_length=1, max_length=100)]
    price_inr: Annotated[int | None, Field(default=None, gt=0)]
