"""Add party ordering and catering workflow."""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261107_08"
down_revision: Union[str, None] = "20261107_07"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("ck_users_role", "users", type_="check")
    op.create_check_constraint(
        "ck_users_role", "users", "role IN ('customer', 'kitchen', 'admin', 'catering')"
    )
    op.add_column("outlets", sa.Column("accepts_party_orders", sa.Boolean(), server_default=sa.text("true"), nullable=False))
    op.create_table(
        "party_orders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("public_id", sa.String(length=16), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("outlet_id", sa.Uuid(), nullable=False),
        sa.Column("event_date", sa.Date(), nullable=False),
        sa.Column("event_time", sa.Time(), nullable=False),
        sa.Column("guests", sa.Integer(), nullable=False),
        sa.Column("delivery_or_pickup", sa.String(length=16), nullable=False),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("contact_name", sa.String(length=160), nullable=False),
        sa.Column("contact_phone", sa.String(length=20), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("items", sa.JSON(), nullable=False),
        sa.Column("estimated_total_inr", sa.Integer(), nullable=False),
        sa.Column("advance_inr", sa.Integer(), nullable=False),
        sa.Column("advance_payment_status", sa.String(length=16), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("manager_note", sa.Text(), nullable=True),
        sa.Column("confirmed_by", sa.Uuid(), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("guests BETWEEN 10 AND 500", name="ck_party_orders_guests"),
        sa.CheckConstraint("delivery_or_pickup IN ('delivery', 'pickup')", name="ck_party_orders_delivery_or_pickup"),
        sa.CheckConstraint("status IN ('requested', 'confirmed', 'rejected', 'cancelled', 'completed')", name="ck_party_orders_status"),
        sa.CheckConstraint("estimated_total_inr >= 0", name="ck_party_orders_total"),
        sa.CheckConstraint("advance_inr >= 0", name="ck_party_orders_advance"),
        sa.CheckConstraint("advance_payment_status IN ('pending', 'paid', 'failed')", name="ck_party_orders_advance_payment_status"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["outlet_id"], ["outlets.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["confirmed_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id"),
    )
    op.create_index("ix_party_orders_user_id", "party_orders", ["user_id"])
    op.create_index("ix_party_orders_outlet_id", "party_orders", ["outlet_id"])
    op.create_index("ix_party_orders_confirmed_by", "party_orders", ["confirmed_by"])
    op.create_table(
        "party_status_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("party_order_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["party_order_id"], ["party_orders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_party_status_events_party_order_id", "party_status_events", ["party_order_id"])


def downgrade() -> None:
    op.drop_index("ix_party_status_events_party_order_id", table_name="party_status_events")
    op.drop_table("party_status_events")
    op.drop_index("ix_party_orders_confirmed_by", table_name="party_orders")
    op.drop_index("ix_party_orders_outlet_id", table_name="party_orders")
    op.drop_index("ix_party_orders_user_id", table_name="party_orders")
    op.drop_table("party_orders")
    op.drop_column("outlets", "accepts_party_orders")
    op.drop_constraint("ck_users_role", "users", type_="check")
    op.create_check_constraint("ck_users_role", "users", "role IN ('customer', 'kitchen', 'admin')")
