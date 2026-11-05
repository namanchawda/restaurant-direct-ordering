from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt

from app.core.config import get_settings

STREAM_TOKEN_TTL_SECONDS = 60
KITCHEN_STREAM_SCOPE = "kitchen_stream"
ORDER_STREAM_SCOPE = "order_stream"


class StreamTokenError(ValueError):
    pass


def create_stream_token(
    *,
    user_id: UUID | str,
    role: str,
    outlet_id: UUID | str | None,
    scope: str,
    order_public_id: str | None = None,
) -> str:
    settings = get_settings()
    now = datetime.now(UTC)
    claims: dict[str, object] = {
        "sub": str(user_id),
        "role": role,
        "outlet_id": str(outlet_id) if outlet_id else None,
        "scope": scope,
        "iat": now,
        "exp": now + timedelta(seconds=STREAM_TOKEN_TTL_SECONDS),
    }
    if order_public_id is not None:
        claims["order_public_id"] = order_public_id
    return jwt.encode(claims, settings.jwt_secret, algorithm="HS256")


def decode_stream_token(token: str, *, expected_scope: str) -> dict[str, object]:
    try:
        claims = jwt.decode(
            token,
            get_settings().jwt_secret,
            algorithms=["HS256"],
        )
    except jwt.InvalidTokenError:
        raise StreamTokenError("Invalid or expired stream token.") from None
    if claims.get("scope") != expected_scope:
        raise StreamTokenError("Stream token is not valid for this endpoint.")
    return claims
