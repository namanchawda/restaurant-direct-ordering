"""Store delivery details and cancellation reason on orders.

Revision ID: 20261105_02
Revises: 20261105_01
Create Date: 2026-11-05
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261105_02"
down_revision: Union[str, None] = "20261105_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("delivery_address", sa.Text(), nullable=True))
    op.add_column("orders", sa.Column("delivery_lat", sa.Float(), nullable=True))
    op.add_column("orders", sa.Column("delivery_lng", sa.Float(), nullable=True))
    op.add_column("orders", sa.Column("notes", sa.Text(), nullable=True))
    op.add_column("orders", sa.Column("cancellation_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "cancellation_reason")
    op.drop_column("orders", "notes")
    op.drop_column("orders", "delivery_lng")
    op.drop_column("orders", "delivery_lat")
    op.drop_column("orders", "delivery_address")
