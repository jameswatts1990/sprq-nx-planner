"""cell tray reuse disabled

Adds `cell_trays.reuse_disabled_at`: a reversible "skip reuse / planning disposal" flag.
When set, autoschedule and Recalculate stop offering any of the tray's cells for reuse
(the lab intends to bin the whole tray). Advisory and non-terminal - unlike a real discard
it touches no cell status and cancels no uses, and clearing it (NULL) restores reuse.

Nullable with no default, so it applies cleanly to an already-populated database.

Revision ID: d7a3f1b9e2c8
Revises: b6d2f8a4c1e9
Create Date: 2026-07-30
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d7a3f1b9e2c8"
down_revision: Union[str, Sequence[str], None] = "b6d2f8a4c1e9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("cell_trays", schema=None) as batch_op:
        batch_op.add_column(sa.Column("reuse_disabled_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("cell_trays", schema=None) as batch_op:
        batch_op.drop_column("reuse_disabled_at")
