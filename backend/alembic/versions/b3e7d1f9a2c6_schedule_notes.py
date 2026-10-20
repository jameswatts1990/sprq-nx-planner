"""schedule_notes: day notes pinned to instruments in the Schedule grid

A note table plus a note<->instrument link table (models/schedule_note.py), so one note can sit
on several instruments' cells for the same day. New tables only - no change to existing rows,
safe on a populated dev.db and on Postgres.

Revision ID: b3e7d1f9a2c6
Revises: a6d2c8f4e1b9
Create Date: 2026-10-20
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3e7d1f9a2c6"
down_revision: Union[str, Sequence[str], None] = "a6d2c8f4e1b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "schedule_notes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("note_date", sa.Date(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_by", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_schedule_notes_note_date", "schedule_notes", ["note_date"], unique=False)
    op.create_table(
        "schedule_note_instruments",
        sa.Column("note_id", sa.Integer(), nullable=False),
        sa.Column("instrument_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["note_id"], ["schedule_notes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["instrument_id"], ["instruments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("note_id", "instrument_id"),
    )


def downgrade() -> None:
    op.drop_table("schedule_note_instruments")
    op.drop_index("ix_schedule_notes_note_date", table_name="schedule_notes")
    op.drop_table("schedule_notes")
