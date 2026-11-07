"""Quality checks that need no database: GST math, privacy payload, stream tokens, secure config."""

from datetime import UTC, datetime, timedelta
import json

import jwt
import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.models import Order, User
from app.services import stream_tokens
from app.services.order_payload import serialize_order

INSECURE_DEFAULT_JWT_SECRET = "replace-this-development-secret-before-deployment"


def _order_for(total_inr: int, **overrides) -> Order:
    placed = datetime.now(UTC) - timedelta(minutes=5)
    values = {
        "total_inr": total_inr,
        "items_subtotal_inr": total_inr,
        "coupon_discount_inr": 0,
        "points_discount_inr": 0,
        "delivery_fee_inr": 0,
        "redeemed_points": 0,
        "status": "cancelled",
        "payment_method": "upi",
        "payment_status": "paid",
        "delivery_address": "Test address, Hyderabad",
        "placed_at": placed,
        "promised_at": placed + timedelta(minutes=30),
        "items": [],
        "status_events": [],
        "estimate_breakdown": None,
    }
    values.update(overrides)
    return Order(**values)


@pytest.mark.parametrize("total_inr", [640, 1030, 1180, 967, 1249])
def test_gst_amount_is_total_times_five_over_105(total_inr: int) -> None:
    order = _order_for(total_inr)
    payload = serialize_order(order)
    assert payload["gst_included_inr"] == round(total_inr * 5 / 105)
    assert payload["price_note"] == "incl. 5% GST"


def test_legacy_order_without_breakdown_still_serializes() -> None:
    order = _order_for(
        1030,
        items_subtotal_inr=None,
        coupon_discount_inr=None,
        points_discount_inr=None,
        delivery_fee_inr=None,
        redeemed_points=None,
        coupon_code=None,
    )
    payload = serialize_order(order)
    assert payload["items_subtotal_inr"] == 1030
    assert payload["total_inr"] == 1030
    assert payload["coupon_discount_inr"] == 0
    assert payload["points_discount_inr"] == 0
    assert payload["delivery_fee_inr"] == 0
    assert payload["redeemed_points"] == 0
    assert payload["earn_points"] == 103
    assert payload["gst_included_inr"] == round(1030 * 5 / 105)
    assert json.dumps(payload, default=str) is not None


def test_kitchen_payload_never_includes_phone_number() -> None:
    order = _order_for(1030)
    order.user = User(name="Test Customer", phone="7000000000", role="customer")
    payload = serialize_order(order)
    serialized = json.dumps(payload, default=str)
    assert payload["customer_first_name"] == "Test"
    assert '"phone"' not in serialized
    assert "7000000000" not in serialized
    assert all("7000000000" not in str(value) for value in payload.values())


def test_stream_token_stream_scope_is_enforced_and_expires() -> None:
    token = stream_tokens.create_stream_token(
        user_id="00000000-0000-0000-0000-000000000001",
        role="customer",
        outlet_id=None,
        scope=stream_tokens.ORDER_STREAM_SCOPE,
        order_public_id="WEB-000001",
    )
    claims = stream_tokens.decode_stream_token(
        token, expected_scope=stream_tokens.ORDER_STREAM_SCOPE
    )
    assert claims["order_public_id"] == "WEB-000001"
    with pytest.raises(stream_tokens.StreamTokenError):
        stream_tokens.decode_stream_token(
            token, expected_scope=stream_tokens.KITCHEN_STREAM_SCOPE
        )

    expired = jwt.encode(
        {
            "sub": "00000000-0000-0000-0000-000000000001",
            "role": "customer",
            "outlet_id": None,
            "scope": stream_tokens.ORDER_STREAM_SCOPE,
            "order_public_id": "WEB-000001",
            "iat": datetime.now(UTC) - timedelta(hours=1),
            "exp": datetime.now(UTC) - timedelta(minutes=59),
        },
        stream_tokens.get_settings().jwt_secret,
        algorithm="HS256",
    )
    with pytest.raises(stream_tokens.StreamTokenError):
        stream_tokens.decode_stream_token(
            expired, expected_scope=stream_tokens.ORDER_STREAM_SCOPE
        )
    assert stream_tokens.STREAM_TOKEN_TTL_SECONDS <= 120


def test_production_refuses_the_insecure_default_jwt_secret() -> None:
    with pytest.raises(ValidationError):
        Settings(environment="production")
    with pytest.raises(ValidationError):
        Settings(environment="production", jwt_secret=INSECURE_DEFAULT_JWT_SECRET)
    secure = Settings(environment="production", jwt_secret="0" * 48)
    assert secure.jwt_secret == "0" * 48
