"""per-sample movie time on samples

Movie / acquisition time (12/24/30 h) becomes a per-sample field: it's importable and
editable on the backlog form, shown on the backlog card, and used as the default run time
when a sample is placed manually (see placement_service.place_sample). Auto-fill still takes
a single run time from its request for now.

The column is NULLABLE (no backfill): rows created before this migration read as the 24h
default everywhere it's used (a null -> DEFAULT_MOVIE_HOURS at read time), and new rows are
always written a concrete 12/24/30 value (engine.normalize.coerce_movie_hours). Nullable
avoids the NOT-NULL-on-a-populated-table failure noted in CLAUDE.md.

Revision ID: c1a7e4d9b2f6
Revises: b7e3d9f1a2c4
Create Date: 2026-07-27
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c1a7e4d9b2f6"
down_revision: Union[str, Sequence[str], None] = "b7e3d9f1a2c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.add_column(sa.Column("movie_time_hours", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.drop_column("movie_time_hours")
