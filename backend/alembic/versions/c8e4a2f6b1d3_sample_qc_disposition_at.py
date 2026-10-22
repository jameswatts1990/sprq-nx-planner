"""qc_disposition_at on samples

When the Cell QC action that tagged a sample's qc_disposition was recorded - drives the
advisory 30-day leftover-complex countdown on "Repeatable - from complex" samples. Nullable
addition; existing tagged samples are left null (no countdown shown) rather than guessed.

Revision ID: c8e4a2f6b1d3
Revises: b3e7d1f9a2c6
Create Date: 2026-10-22
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c8e4a2f6b1d3"
down_revision: Union[str, Sequence[str], None] = "b3e7d1f9a2c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.add_column(sa.Column("qc_disposition_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.drop_column("qc_disposition_at")
