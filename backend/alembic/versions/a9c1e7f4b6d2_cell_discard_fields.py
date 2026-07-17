"""add cell discard fields

"Discard Cells" (weekly schedule grid, per-tray) forces every cell physically
in a tray to status "exhausted" regardless of its actual remaining use count.
Unlike the natural exhausted status (derived from uses_consumed vs max_uses
in recompute_status), a forced discard must be sticky - recompute_status must
never flip it back to "open"/"window_expired" just because the cell's real
use count says it still had capacity left. discarded_at/discarded_reason are
the guard: recompute_status early-returns whenever discarded_at is set, the
same way it already does for "retired"/"stopped". Both columns are nullable
additions, no backfill required.

Revision ID: a9c1e7f4b6d2
Revises: c7f3a1e9d5b2
Create Date: 2026-07-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a9c1e7f4b6d2"
down_revision: Union[str, Sequence[str], None] = "c7f3a1e9d5b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("cells", schema=None) as batch_op:
        batch_op.add_column(sa.Column("discarded_reason", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("discarded_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("cells", schema=None) as batch_op:
        batch_op.drop_column("discarded_at")
        batch_op.drop_column("discarded_reason")
