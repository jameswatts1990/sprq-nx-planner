"""samples: drop control_dilution_3_volume

The Control Dilution 3 volume is always 1 µL, so it's no longer stored per sample - the
batch sheet now prints a fixed 1 µL for it (see BatchSheetPage). Drops the now-redundant
column; the scheduler sheet's "Volume of Control Dilution 3" column is simply ignored on
import from here on.

dev.db note: SQLite drops the column via batch_alter_table (table copy); safe on this
project's disposable dev.db.

Revision ID: b6d2f8a4c1e9
Revises: f4a9c2e7b1d6
Create Date: 2026-07-28
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b6d2f8a4c1e9"
down_revision: Union[str, Sequence[str], None] = "f4a9c2e7b1d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.drop_column("control_dilution_3_volume")


def downgrade() -> None:
    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.add_column(sa.Column("control_dilution_3_volume", sa.Float(), nullable=True))
