"""grid scheduler redesign

Drops the Schedule concept. A RunBatch is now one (instrument, calendar-day) grid run,
carrying run_date directly under a unique (instrument_id, run_date) constraint. RunBatch:Cycle
is 1:1 and calendar-day-scoped, so the old batch_index / use_index columns are meaningless
and removed. A unique (cycle_id, well) constraint stops two placements landing on one well.

dev.db's schedules/run_batches/cycles/cell_uses tables are empty, so this is a pure schema
change - no data backfill needed.

Revision ID: a1f4c9d2b7e3
Revises: c4ce50a58b19
Create Date: 2026-07-09
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1f4c9d2b7e3"
down_revision: Union[str, Sequence[str], None] = "c4ce50a58b19"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # run_batches: drop schedule linkage, add run_date + unique(instrument_id, run_date)
    op.drop_index("ix_run_batches_schedule_id", table_name="run_batches")
    with op.batch_alter_table("run_batches", schema=None) as batch_op:
        batch_op.add_column(sa.Column("run_date", sa.Date(), nullable=False))
        batch_op.create_index(op.f("ix_run_batches_run_date"), ["run_date"], unique=False)
        batch_op.create_unique_constraint("uq_run_batch_instrument_date", ["instrument_id", "run_date"])
        batch_op.drop_column("schedule_id")
        batch_op.drop_column("batch_index")

    # schedules table is gone entirely
    op.drop_index("ix_schedules_status", table_name="schedules")
    op.drop_table("schedules")

    # cycles: use_index no longer meaningful (RunBatch:Cycle is 1:1)
    with op.batch_alter_table("cycles", schema=None) as batch_op:
        batch_op.drop_column("use_index")

    # cell_uses: drop use_index, add unique(cycle_id, well) race backstop
    with op.batch_alter_table("cell_uses", schema=None) as batch_op:
        batch_op.create_unique_constraint("uq_cell_use_cycle_well", ["cycle_id", "well"])
        batch_op.drop_column("use_index")


def downgrade() -> None:
    with op.batch_alter_table("cell_uses", schema=None) as batch_op:
        batch_op.add_column(sa.Column("use_index", sa.Integer(), nullable=False, server_default="0"))
        batch_op.drop_constraint("uq_cell_use_cycle_well", type_="unique")

    with op.batch_alter_table("cycles", schema=None) as batch_op:
        batch_op.add_column(sa.Column("use_index", sa.Integer(), nullable=False, server_default="0"))

    op.create_table(
        "schedules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False
        ),
        sa.Column("created_by", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("settings_json", sa.JSON(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_schedules_status"), "schedules", ["status"], unique=False)

    with op.batch_alter_table("run_batches", schema=None) as batch_op:
        batch_op.add_column(sa.Column("schedule_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("batch_index", sa.Integer(), nullable=False, server_default="0"))
        batch_op.drop_constraint("uq_run_batch_instrument_date", type_="unique")
        batch_op.drop_index(op.f("ix_run_batches_run_date"))
        batch_op.create_foreign_key(
            "fk_run_batches_schedule_id", "schedules", ["schedule_id"], ["id"], ondelete="CASCADE"
        )
        batch_op.drop_column("run_date")
    op.create_index("ix_run_batches_schedule_id", "run_batches", ["schedule_id"], unique=False)
