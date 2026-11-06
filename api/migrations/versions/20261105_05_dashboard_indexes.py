"""indexes for dashboard date and status-event aggregations"""
from alembic import op

revision = "20261105_05"
down_revision = "20261105_04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_orders_outlet_id_placed_at",
        "orders",
        ["outlet_id", "placed_at"],
    )
    op.create_index(
        "ix_order_status_events_order_id_status",
        "order_status_events",
        ["order_id", "status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_order_status_events_order_id_status", table_name="order_status_events"
    )
    op.drop_index("ix_orders_outlet_id_placed_at", table_name="orders")
