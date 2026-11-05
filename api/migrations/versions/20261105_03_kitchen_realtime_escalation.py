"""Add kitchen escalation timestamps to orders.

Revision ID: 20261105_03
Revises: 20261105_02
Create Date: 2026-11-05
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261105_03"
down_revision: Union[str, None] = "20261105_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "orders", sa.Column("escalated_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "orders",
        sa.Column(
            "escalation_acknowledged_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("orders", "escalation_acknowledged_at")
    op.drop_column("orders", "escalated_at")
