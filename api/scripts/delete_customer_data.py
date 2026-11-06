r"""Admin privacy tool: erase one customer's data (DPDP deletion request).

Run from ``api`` after verifying the customer's phone number against an
approved deletion request:

    .\.venv\Scripts\python -m scripts.delete_customer_data --phone 7000123456
    .\.venv\Scripts\python -m scripts.delete_customer_data --phone 7000123456 --apply

The default is a dry run that only reports what would be deleted. ``--apply``
removes the customer's account, their orders (items and status events are
removed by the database cascade) and their marketing consent, and cannot be
undone. Kitchen and admin accounts are never touched.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.db.session import create_database_engine
from app.models import Order, User
from app.services.privacy import delete_customer_data


async def run(
    phone: str,
    apply: bool,
    *,
    session,
) -> dict[str, object]:
    user = await session.scalar(sa.select(User).where(User.phone == phone))
    if user is None:
        return {"phone": phone, "found": False, "deleted_orders": 0}
    if user.role != "customer":
        return {
            "phone": phone,
            "found": True,
            "role": user.role,
            "deleted_orders": 0,
            "error": "Only customer accounts can be erased by this tool.",
        }

    orders = (
        await session.scalars(sa.select(Order).where(Order.user_id == user.id))
    ).all()
    if not apply:
        return {
            "phone": phone,
            "found": True,
            "role": user.role,
            "dry_run": True,
            "orders": len(orders),
        }
    result = await delete_customer_data(session, phone)
    result["found"] = True
    result["role"] = user.role
    return result


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phone", required=True, help="Customer phone number.")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Delete the records. Default: dry run that shows the counts only.",
    )
    args = parser.parse_args()

    engine = create_database_engine()
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with session_factory() as session:
            result = await run(args.phone, args.apply, session=session)
            print(json.dumps(result, indent=2))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
