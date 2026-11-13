"""instrument_downtimes: dated downtime periods replace the single down_from flag

Creates `instrument_downtimes` (models/instrument_downtime.py): start_date, end_date (NULL =
open-ended, inclusive), kind planned|unplanned, note, created_by. Each instrument's existing
`down_from`/`down_note` becomes one open-ended *unplanned* period (created_by "migration"), so a
currently-down instrument stays down with the same note; then both columns are dropped.

The drop uses batch_alter_table, which on SQLite copies the instruments table (its unique
serial_number index is recreated by the copy); on Postgres it's a plain ALTER TABLE DROP COLUMN.
Downgrade copies each instrument's open-ended period back into the columns (the only shape the old
flag could express), so a round trip keeps the "down from" state but loses dated/planned history.

Revision ID: d5a1c7e3f9b2
Revises: c3f8a1d6e2b9
Create Date: 2026-11-13
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d5a1c7e3f9b2"
down_revision: Union[str, Sequence[str], None] = "c3f8a1d6e2b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "instrument_downtimes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("instrument_id", sa.Integer(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["instrument_id"], ["instruments.id"], ondelete="CASCADE"),
        sa.CheckConstraint("kind IN ('planned', 'unplanned')", name="ck_instrument_downtimes_kind"),
        sa.CheckConstraint("end_date IS NULL OR end_date >= start_date", name="ck_instrument_downtimes_dates"),
    )
    op.create_index(
        "ix_instrument_downtimes_instrument_id", "instrument_downtimes", ["instrument_id"], unique=False
    )
    op.execute(
        "INSERT INTO instrument_downtimes (instrument_id, start_date, end_date, kind, note, created_by) "
        "SELECT id, down_from, NULL, 'unplanned', down_note, 'migration' "
        "FROM instruments WHERE down_from IS NOT NULL"
    )
    with op.batch_alter_table("instruments", schema=None) as batch_op:
        batch_op.drop_column("down_note")
        batch_op.drop_column("down_from")


def downgrade() -> None:
    with op.batch_alter_table("instruments", schema=None) as batch_op:
        batch_op.add_column(sa.Column("down_from", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("down_note", sa.Text(), nullable=True))
    # Periods never overlap, so an instrument has at most one open-ended period.
    op.execute(
        "UPDATE instruments SET "
        "down_from = (SELECT d.start_date FROM instrument_downtimes d "
        "  WHERE d.instrument_id = instruments.id AND d.end_date IS NULL), "
        "down_note = (SELECT d.note FROM instrument_downtimes d "
        "  WHERE d.instrument_id = instruments.id AND d.end_date IS NULL)"
    )
    op.drop_index("ix_instrument_downtimes_instrument_id", table_name="instrument_downtimes")
    op.drop_table("instrument_downtimes")
