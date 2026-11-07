"""Add server-authoritative loyalty, coupons, and order breakdowns."""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "20261107_07"
down_revision: Union[str, None] = "20261106_06"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.add_column("orders", sa.Column("items_subtotal_inr", sa.Integer(), server_default=sa.text("0"), nullable=False))
    op.add_column("orders", sa.Column("coupon_discount_inr", sa.Integer(), server_default=sa.text("0"), nullable=False))
    op.add_column("orders", sa.Column("points_discount_inr", sa.Integer(), server_default=sa.text("0"), nullable=False))
    op.add_column("orders", sa.Column("delivery_fee_inr", sa.Integer(), server_default=sa.text("0"), nullable=False))
    op.add_column("orders", sa.Column("coupon_code", sa.String(40), nullable=True))
    op.add_column("orders", sa.Column("redeemed_points", sa.Integer(), server_default=sa.text("0"), nullable=False))
    op.create_table("loyalty_accounts", sa.Column("id", sa.Uuid(), nullable=False), sa.Column("user_id", sa.Uuid(), nullable=False), sa.Column("balance_points", sa.Integer(), server_default=sa.text("0"), nullable=False), sa.Column("lifetime_points", sa.Integer(), server_default=sa.text("0"), nullable=False), sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"), sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("user_id"))
    op.create_index("ix_loyalty_accounts_user_id", "loyalty_accounts", ["user_id"])
    op.create_table("loyalty_transactions", sa.Column("id", sa.Uuid(), nullable=False), sa.Column("user_id", sa.Uuid(), nullable=False), sa.Column("order_id", sa.Uuid(), nullable=True), sa.Column("type", sa.String(16), nullable=False), sa.Column("points", sa.Integer(), nullable=False), sa.Column("balance_after", sa.Integer(), nullable=False), sa.Column("note", sa.Text(), nullable=True), sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False), sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"), sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="SET NULL"), sa.PrimaryKeyConstraint("id"))
    op.create_index("ix_loyalty_transactions_user_id", "loyalty_transactions", ["user_id"])
    op.create_index("ix_loyalty_transactions_order_id", "loyalty_transactions", ["order_id"])
    op.create_table("coupons", sa.Column("id", sa.Uuid(), nullable=False), sa.Column("code", sa.String(40), nullable=False), sa.Column("type", sa.String(16), nullable=False), sa.Column("value", sa.Integer(), nullable=False), sa.Column("min_order_inr", sa.Integer(), server_default=sa.text("0"), nullable=False), sa.Column("max_discount_inr", sa.Integer(), nullable=True), sa.Column("valid_from", sa.DateTime(timezone=True), nullable=True), sa.Column("valid_to", sa.DateTime(timezone=True), nullable=True), sa.Column("usage_limit_total", sa.Integer(), nullable=True), sa.Column("usage_limit_per_user", sa.Integer(), nullable=True), sa.Column("first_order_only", sa.Boolean(), server_default=sa.text("false"), nullable=False), sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False), sa.Column("is_demo", sa.Boolean(), server_default=sa.text("false"), nullable=False), sa.CheckConstraint("type IN ('percent', 'flat')", name="ck_coupons_type"), sa.CheckConstraint("value >= 0", name="ck_coupons_value"), sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("code"))
    op.create_table("coupon_redemptions", sa.Column("id", sa.Uuid(), nullable=False), sa.Column("coupon_id", sa.Uuid(), nullable=False), sa.Column("user_id", sa.Uuid(), nullable=False), sa.Column("order_id", sa.Uuid(), nullable=False), sa.ForeignKeyConstraint(["coupon_id"], ["coupons.id"], ondelete="CASCADE"), sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"), sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"), sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("coupon_id", "order_id", name="uq_coupon_redemption_order"), sa.UniqueConstraint("order_id"))
    op.create_index("ix_coupon_redemptions_coupon_id", "coupon_redemptions", ["coupon_id"])
    op.create_index("ix_coupon_redemptions_user_id", "coupon_redemptions", ["user_id"])
    op.create_index("ix_coupon_redemptions_order_id", "coupon_redemptions", ["order_id"])

def downgrade() -> None:
    op.drop_table("coupon_redemptions"); op.drop_table("coupons")
    op.drop_index("ix_loyalty_transactions_order_id", table_name="loyalty_transactions"); op.drop_index("ix_loyalty_transactions_user_id", table_name="loyalty_transactions"); op.drop_table("loyalty_transactions")
    op.drop_index("ix_loyalty_accounts_user_id", table_name="loyalty_accounts"); op.drop_table("loyalty_accounts")
    for name in ("redeemed_points", "coupon_code", "delivery_fee_inr", "points_discount_inr", "coupon_discount_inr", "items_subtotal_inr"):
        op.drop_column("orders", name)
