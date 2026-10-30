"""cell_type on cells

Whether a physical SMRT Cell is a multi-use SPRQ-Nx cell ("sprq_nx", up to 3 uses) or a
single-use SPRQ cell ("sprq"). Every existing cell was created as SPRQ-Nx, so the server
default backfills them correctly.

Revision ID: d9b4e1a7c3f2
Revises: c8e4a2f6b1d3
Create Date: 2026-10-30
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d9b4e1a7c3f2"
down_revision: Union[str, Sequence[str], None] = "c8e4a2f6b1d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("cells", schema=None) as batch_op:
        batch_op.add_column(sa.Column("cell_type", sa.String(length=16), nullable=False, server_default="sprq_nx"))


def downgrade() -> None:
    with op.batch_alter_table("cells", schema=None) as batch_op:
        batch_op.drop_column("cell_type")
