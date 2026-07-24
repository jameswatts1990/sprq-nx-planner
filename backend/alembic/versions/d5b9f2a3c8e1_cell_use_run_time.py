"""per-cell run time on cell_uses

Run time (movie hours) moves from being a single per-run value on cycles.movie_hours
to a per-well value on each CellUse, so different wells of the same run can carry
different movie times. cycles.movie_hours is kept as the run's *representative* (longest)
run time, recomputed by placement_service.recompute_cycle_timing.

Existing rows are backfilled from their owning cycle's movie_hours so nothing changes for
already-scheduled runs. The column is NOT NULL with a server_default of "24" so the add
never fails on a table that already holds rows (the project's dev.db / any populated DB) -
see CLAUDE.md's note on breaking schema changes against populated tables.

Revision ID: d5b9f2a3c8e1
Revises: c9e4b7a2f1d8
Create Date: 2026-07-24
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d5b9f2a3c8e1"
down_revision: Union[str, Sequence[str], None] = "c9e4b7a2f1d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("cell_uses", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("run_time_hours", sa.Integer(), nullable=False, server_default="24")
        )
    # Backfill each existing use from its owning cycle's (previously authoritative) run time,
    # so runs scheduled before this migration keep exactly the run time they had.
    op.execute(
        "UPDATE cell_uses SET run_time_hours = ("
        "SELECT movie_hours FROM cycles WHERE cycles.id = cell_uses.cycle_id"
        ") WHERE cycle_id IN (SELECT id FROM cycles)"
    )


def downgrade() -> None:
    with op.batch_alter_table("cell_uses", schema=None) as batch_op:
        batch_op.drop_column("run_time_hours")
