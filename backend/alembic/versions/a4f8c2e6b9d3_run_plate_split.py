"""Run -> Plate split: run_batches becomes the Run, cycles become Plates

Re-models scheduling around the SMRT Link *run design*. A RunBatch is now a **Run** - one
physical load session on an instrument (``load_date``, formerly ``run_date``) carrying a
run-level ``run_name`` (Traction ID, moved down from Cycle). A Cycle is now a **Plate** -
one acquisition round within that run, with its own ``acquire_date`` and ``plate_index``
(1 or 2). A run holds 1-2 plates; the existing (cycle_id, well) unique constraint therefore
becomes per-plate, which is what lets a reuse run keep the same well (A01) on both plates.

Populated-DB safe (see CLAUDE.md): new NOT-NULL columns are either server-defaulted
(``plate_index``) or added nullable, backfilled, then tightened (``load_date``,
``acquire_date``) - so this never hits the run_date-style IntegrityError on a table with
rows. Existing runs migrate as: load_date = old run_date, every existing cycle becomes
Plate 1 acquiring on that load_date, run_name lifts from the (pre-split 1:1) cycle. Legacy
reuse runs and >4-well single-use cycles are intentionally NOT retro-transformed - the new
model governs new scheduling only. Recommended: wipe and re-migrate dev.db (disposable).

Revision ID: a4f8c2e6b9d3
Revises: d5b9f2a3c8e1
Create Date: 2026-07-24
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a4f8c2e6b9d3"
down_revision: Union[str, Sequence[str], None] = "d5b9f2a3c8e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- run_batches becomes the Run: add run_name + load_date, backfill, retire run_date ---
    with op.batch_alter_table("run_batches", schema=None) as batch_op:
        batch_op.add_column(sa.Column("run_name", sa.String(length=128), nullable=True))
        batch_op.add_column(sa.Column("load_date", sa.Date(), nullable=True))
    # load_date carries the old acquisition day forward; run_name lifts from the single
    # (pre-split 1:1) cycle so already-named runs keep their Traction ID.
    op.execute("UPDATE run_batches SET load_date = run_date")
    op.execute(
        "UPDATE run_batches SET run_name = ("
        "SELECT c.run_name FROM cycles c WHERE c.run_batch_id = run_batches.id ORDER BY c.id LIMIT 1"
        ")"
    )
    with op.batch_alter_table("run_batches", schema=None) as batch_op:
        batch_op.alter_column("load_date", existing_type=sa.Date(), nullable=False)
        batch_op.create_index(op.f("ix_run_batches_load_date"), ["load_date"], unique=False)
        batch_op.create_unique_constraint("uq_run_batch_instrument_load_date", ["instrument_id", "load_date"])
        batch_op.drop_constraint("uq_run_batch_instrument_date", type_="unique")
        batch_op.drop_index(op.f("ix_run_batches_run_date"))
        batch_op.drop_column("run_date")

    # --- cycles become Plates: add plate_index + acquire_date, backfill, retire run_name ---
    with op.batch_alter_table("cycles", schema=None) as batch_op:
        batch_op.add_column(sa.Column("plate_index", sa.Integer(), nullable=False, server_default="1"))
        batch_op.add_column(sa.Column("acquire_date", sa.Date(), nullable=True))
    # Every existing cycle becomes Plate 1 (server_default), acquiring on its run's load_date.
    op.execute(
        "UPDATE cycles SET acquire_date = ("
        "SELECT rb.load_date FROM run_batches rb WHERE rb.id = cycles.run_batch_id"
        ")"
    )
    with op.batch_alter_table("cycles", schema=None) as batch_op:
        batch_op.alter_column("acquire_date", existing_type=sa.Date(), nullable=False)
        batch_op.create_index(op.f("ix_cycles_acquire_date"), ["acquire_date"], unique=False)
        batch_op.create_unique_constraint("uq_cycle_run_plate", ["run_batch_id", "plate_index"])
        batch_op.drop_column("run_name")


def downgrade() -> None:
    # --- cycles: restore run_name (from the parent run), drop plate columns ---
    with op.batch_alter_table("cycles", schema=None) as batch_op:
        batch_op.add_column(sa.Column("run_name", sa.String(length=128), nullable=True))
    op.execute(
        "UPDATE cycles SET run_name = ("
        "SELECT rb.run_name FROM run_batches rb WHERE rb.id = cycles.run_batch_id"
        ")"
    )
    with op.batch_alter_table("cycles", schema=None) as batch_op:
        batch_op.drop_constraint("uq_cycle_run_plate", type_="unique")
        batch_op.drop_index(op.f("ix_cycles_acquire_date"))
        batch_op.drop_column("acquire_date")
        batch_op.drop_column("plate_index")

    # --- run_batches: restore run_date (from load_date), drop run columns ---
    with op.batch_alter_table("run_batches", schema=None) as batch_op:
        batch_op.add_column(sa.Column("run_date", sa.Date(), nullable=True))
    op.execute("UPDATE run_batches SET run_date = load_date")
    with op.batch_alter_table("run_batches", schema=None) as batch_op:
        batch_op.alter_column("run_date", existing_type=sa.Date(), nullable=False)
        batch_op.create_index(op.f("ix_run_batches_run_date"), ["run_date"], unique=False)
        batch_op.create_unique_constraint("uq_run_batch_instrument_date", ["instrument_id", "run_date"])
        batch_op.drop_constraint("uq_run_batch_instrument_load_date", type_="unique")
        batch_op.drop_index(op.f("ix_run_batches_load_date"))
        batch_op.drop_column("load_date")
        batch_op.drop_column("run_name")
