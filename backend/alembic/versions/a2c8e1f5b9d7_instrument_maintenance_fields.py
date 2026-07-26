"""instrument maintenance (down) fields

Adds "down for maintenance" tracking to instruments: `down_from` (the date an
instrument went down, NULL when online) and `down_note` (an optional reason).
Both are nullable additions with no backfill - safe on a populated dev.db and on
Postgres (unlike a NOT NULL column add). A down instrument stays visible in the
schedule, greyed from `down_from` onward, and refuses new runs from that date;
this is distinct from `active` (permanent retire / hidden from the grid).

Revision ID: a2c8e1f5b9d7
Revises: f3b9c1a7e2d5
Create Date: 2026-07-26
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a2c8e1f5b9d7"
down_revision: Union[str, Sequence[str], None] = "f3b9c1a7e2d5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("instruments", schema=None) as batch_op:
        batch_op.add_column(sa.Column("down_from", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("down_note", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("instruments", schema=None) as batch_op:
        batch_op.drop_column("down_note")
        batch_op.drop_column("down_from")
