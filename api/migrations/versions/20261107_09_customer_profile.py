"""Add customer profile, saved addresses and favourites."""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261107_09"
down_revision: Union[str, None] = "20261107_08"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "customer_addresses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("label", sa.String(length=20), nullable=False),
        sa.Column("address", sa.Text(), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("is_default", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("label IN ('home', 'work', 'other')", name="ck_customer_addresses_label"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_customer_addresses_user_id", "customer_addresses", ["user_id"])

    op.create_table(
        "customer_favourites",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("item_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["item_id"], ["menu_items.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "item_id", name="uq_customer_favourites_user_item"),
    )
    op.create_index("ix_customer_favourites_user_id", "customer_favourites", ["user_id"])
    op.create_index("ix_customer_favourites_item_id", "customer_favourites", ["item_id"])


def downgrade() -> None:
    op.drop_index("ix_customer_favourites_item_id", table_name="customer_favourites")
    op.drop_index("ix_customer_favourites_user_id", table_name="customer_favourites")
    op.drop_table("customer_favourites")
    op.drop_index("ix_customer_addresses_user_id", table_name="customer_addresses")
    op.drop_table("customer_addresses")
