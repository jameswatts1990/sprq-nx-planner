"""cell_type on pacbio_cases

Which kind of SMRT Cell a credit case logged without a RunNx cell is about - multi-use SPRQ-Nx
("sprq_nx") or single-use SPRQ ("sprq"). A cell's own case reads it off the cell; a no-cell
case has to be told. PacBio credits acquisitions, and a SPRQ cell is 1 acquisition where a
SPRQ-Nx cell is 3, so the QC page needs it to turn credited acquisitions into cells/trays.
Every existing case predates SPRQ, so the server default backfills them correctly.

Revision ID: e5c1a9d3f7b2
Revises: d9b4e1a7c3f2
Create Date: 2026-10-30
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5c1a9d3f7b2"
down_revision: Union[str, Sequence[str], None] = "d9b4e1a7c3f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("pacbio_cases", schema=None) as batch_op:
        batch_op.add_column(sa.Column("cell_type", sa.String(length=16), nullable=False, server_default="sprq_nx"))


def downgrade() -> None:
    with op.batch_alter_table("pacbio_cases", schema=None) as batch_op:
        batch_op.drop_column("cell_type")
