"""add cell_use notes field

A free-text note the lab user attaches to a sample-on-a-cell placement
(CellUse), distinct from the existing outcome_notes QC field. Viewable and
editable from the slot-detail popover and printed on the batch sheet. Nullable
addition, no backfill required.

Revision ID: c9e4b7a2f1d8
Revises: b8d1f3a5c7e9
Create Date: 2026-07-24
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c9e4b7a2f1d8"
down_revision: Union[str, Sequence[str], None] = "b8d1f3a5c7e9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("cell_uses", schema=None) as batch_op:
        batch_op.add_column(sa.Column("notes", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("cell_uses", schema=None) as batch_op:
        batch_op.drop_column("notes")
