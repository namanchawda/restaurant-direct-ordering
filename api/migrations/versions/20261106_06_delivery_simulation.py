"""Add fictional riders and stateless delivery simulation timestamps."""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "20261106_06"
down_revision: Union[str, None] = "20261105_05"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "riders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("vehicle_number", sa.String(length=40), nullable=False),
        sa.Column("rating", sa.Float(), nullable=False),
        sa.Column("masked_phone", sa.String(length=20), nullable=False),
        sa.Column("is_available", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.CheckConstraint("rating BETWEEN 0 AND 5", name="ck_riders_rating"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.add_column("orders", sa.Column("rider_id", sa.Uuid(), nullable=True))
    op.add_column("orders", sa.Column("rider_assigned_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("orders", sa.Column("picked_up_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("orders", sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("orders", sa.Column("delivery_eta_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_orders_rider_id", "orders", ["rider_id"])
    op.create_foreign_key("fk_orders_rider_id", "orders", "riders", ["rider_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint("fk_orders_rider_id", "orders", type_="foreignkey")
    op.drop_index("ix_orders_rider_id", table_name="orders")
    for name in ("delivery_eta_at", "delivered_at", "picked_up_at", "rider_assigned_at", "rider_id"):
        op.drop_column("orders", name)
    op.drop_table("riders")
