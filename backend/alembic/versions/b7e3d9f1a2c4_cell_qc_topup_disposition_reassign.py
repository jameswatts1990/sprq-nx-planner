"""cell qc: sample top-ups, qc disposition tag, and cell-use reassignment

Supports the re-imagined Cell QC flow (see services/qc_service.py):
  * sample_topups - a new table tracking "Lost" samples that need fresh material
    (request_sent_at stamped by "Request Sent", the row deleted by "Cancel").
  * samples.qc_disposition - "repeatable"/"recoverable" tag driving the Backlog's
    "Recoverable Samples" section (edit-proof, unlike the free-text priority label).
  * cell_uses.reassigned_from_cell_id - records the originally-planned cell when a QC
    tray re-zip shifts an acquisition onto a different physical cell (drives the grid's
    "reassigned" flag and undo).

All additions are nullable / a new table - no backfill, safe on a populated dev.db and
on Postgres (heeds the NOT-NULL-on-existing-rows caveat in CLAUDE.md).

Revision ID: b7e3d9f1a2c4
Revises: a2c8e1f5b9d7
Create Date: 2026-07-27
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7e3d9f1a2c4"
down_revision: Union[str, Sequence[str], None] = "a2c8e1f5b9d7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sample_topups",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("sample_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("request_sent_at", sa.Date(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("source_cell_use_id", sa.Integer(), nullable=True),
        sa.Column("created_by", sa.String(length=120), nullable=True),
        sa.ForeignKeyConstraint(["sample_id"], ["samples.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_cell_use_id"], ["cell_uses.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_sample_topups_sample_id", "sample_topups", ["sample_id"], unique=False)

    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.add_column(sa.Column("qc_disposition", sa.String(length=20), nullable=True))
        batch_op.create_index(batch_op.f("ix_samples_qc_disposition"), ["qc_disposition"], unique=False)

    with op.batch_alter_table("cell_uses", schema=None) as batch_op:
        batch_op.add_column(sa.Column("reassigned_from_cell_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_cell_uses_reassigned_from_cell_id", "cells", ["reassigned_from_cell_id"], ["id"]
        )


def downgrade() -> None:
    with op.batch_alter_table("cell_uses", schema=None) as batch_op:
        batch_op.drop_constraint("fk_cell_uses_reassigned_from_cell_id", type_="foreignkey")
        batch_op.drop_column("reassigned_from_cell_id")

    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_samples_qc_disposition"))
        batch_op.drop_column("qc_disposition")

    op.drop_index("ix_sample_topups_sample_id", table_name="sample_topups")
    op.drop_table("sample_topups")
