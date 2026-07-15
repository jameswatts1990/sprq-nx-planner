"""add cell qc and credit fields

Adds the fields needed for the cell QC workflow: a "stopped" reason/timestamp
for cells taken permanently out of service (all future uses lost), and PacBio
credit tracking (case number, reported/confirmed/received timestamps) so a
cell flagged Failed or Stopped can be followed through to a physical credit.
All columns are nullable additions - no backfill required, and CELL_STATUSES
gains a new "stopped" value (a plain String column, so no schema change is
needed for the enum itself).

Revision ID: e6a2d4b8f1c3
Revises: d3e8a1c9f2b4
Create Date: 2026-07-15
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e6a2d4b8f1c3"
down_revision: Union[str, Sequence[str], None] = "d3e8a1c9f2b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("cells", schema=None) as batch_op:
        batch_op.add_column(sa.Column("stopped_reason", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("stopped_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("pacbio_case_number", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("pacbio_reported_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("pacbio_credit_confirmed_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("credit_received_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.create_index(batch_op.f("ix_cells_pacbio_case_number"), ["pacbio_case_number"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("cells", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_cells_pacbio_case_number"))
        batch_op.drop_column("credit_received_at")
        batch_op.drop_column("pacbio_credit_confirmed_at")
        batch_op.drop_column("pacbio_reported_at")
        batch_op.drop_column("pacbio_case_number")
        batch_op.drop_column("stopped_at")
        batch_op.drop_column("stopped_reason")
