"""instrument location and asset number fields

Adds two purely descriptive columns to instruments for the lab's own records:
`location` (where the instrument physically lives) and `asset_number` (its
asset-register number). Both are nullable additions with no backfill - safe on a
populated dev.db and on Postgres (unlike a NOT NULL column add). Nothing in
scheduling reads these; they are edited from the instrument card's Edit dialog.

Revision ID: b7d2e9a1c3f4
Revises: a3f1c8e2d4b6
Create Date: 2026-07-31
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7d2e9a1c3f4"
down_revision: Union[str, Sequence[str], None] = "a3f1c8e2d4b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("instruments", schema=None) as batch_op:
        batch_op.add_column(sa.Column("location", sa.String(length=120), nullable=True))
        batch_op.add_column(sa.Column("asset_number", sa.String(length=64), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("instruments", schema=None) as batch_op:
        batch_op.drop_column("asset_number")
        batch_op.drop_column("location")
