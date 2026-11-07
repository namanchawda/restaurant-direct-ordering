"""Pure rules for customer saved addresses and favourites."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

ADDRESS_LIMIT = 5


def address_limit_error() -> str:
    return "You can save up to 5 addresses."


def at_address_limit(current_count: int) -> bool:
    return current_count >= ADDRESS_LIMIT


def default_switch_plan(
    addresses: list[dict[str, Any]], set_default_id: UUID | None
) -> tuple[list[UUID], UUID | None]:
    """Return (address ids to clear as default, id to set as default).

    At most one address is the default. Clearing is only needed when the
    target default differs from the current default.
    """
    current_default_id = next(
        (address["id"] for address in addresses if address["is_default"]), None
    )
    clear_ids: list[UUID] = []
    if current_default_id is not None and current_default_id != set_default_id:
        clear_ids.append(current_default_id)
    return clear_ids, set_default_id


def promote_after_delete(
    addresses: list[dict[str, Any]], deleted_id: UUID
) -> UUID | None:
    """Return the id of the most recent remaining address to become default."""
    remaining = [address for address in addresses if address["id"] != deleted_id]
    if not remaining:
        return None
    return max(remaining, key=lambda address: address["created_at"])["id"]
