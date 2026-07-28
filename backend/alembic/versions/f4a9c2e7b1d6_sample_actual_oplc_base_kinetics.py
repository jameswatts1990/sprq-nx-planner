"""samples: drop volume, add actual_oplc, rename ccs_kinetics->base_kinetics; add app_settings

Three sample-schema changes plus the new key/value settings table:
  - drop `samples.volume` — the single "Volume to Load" field is superseded by the more
    specific cleaned-complex / loading-buffer / control-dilution volumes.
  - add `samples.actual_oplc` (Float, nullable) — the achieved on-plate loading conc,
    distinct from the planned Target OPLC; round-trips the tracker's "Loading Conc." column.
  - rename `samples.ccs_kinetics` -> `samples.base_kinetics` (terminology only).
  - create `app_settings` (key/value) backing the admin "Sample defaults" panel.

dev.db note: SQLite performs the column drop/add/rename via batch_alter_table (table copy);
safe on this project's disposable dev.db. No NOT NULL columns are added, so existing rows
migrate cleanly (actual_oplc defaults to NULL).

Revision ID: f4a9c2e7b1d6
Revises: a4c8e1f7d3b2
Create Date: 2026-07-28
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f4a9c2e7b1d6"
down_revision: Union[str, Sequence[str], None] = "a4c8e1f7d3b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.drop_column("volume")
        batch_op.add_column(sa.Column("actual_oplc", sa.Float(), nullable=True))
        batch_op.alter_column("ccs_kinetics", new_column_name="base_kinetics")

    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("value", sa.String(length=255), nullable=True),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    op.drop_table("app_settings")

    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.alter_column("base_kinetics", new_column_name="ccs_kinetics")
        batch_op.drop_column("actual_oplc")
        batch_op.add_column(sa.Column("volume", sa.Float(), nullable=True))
