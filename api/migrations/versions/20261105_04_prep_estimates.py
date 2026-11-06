"""prep estimate inputs and audit breakdown"""
from alembic import op
import sqlalchemy as sa

revision = "20261105_04"
down_revision = "20261105_03"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("categories", sa.Column("prep_weight_minutes", sa.Integer(), nullable=False, server_default="10"))
    op.add_column("outlets", sa.Column("kitchen_capacity", sa.Integer(), nullable=False, server_default="20"))
    op.add_column("orders", sa.Column("estimate_breakdown", sa.JSON(), nullable=True))

def downgrade():
    op.drop_column("orders", "estimate_breakdown")
    op.drop_column("outlets", "kitchen_capacity")
    op.drop_column("categories", "prep_weight_minutes")
