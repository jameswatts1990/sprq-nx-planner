"""add cell internal report fields

Adds the "internal report" stage of the PacBio credit workflow: a link to the
lab's own write-up of a cell failure (e.g. a Google Sheet row / doc) and the
timestamp it was raised. This is the first actionable step after a Failure is
flagged, before PacBio is contacted. Both columns are nullable additions - no
backfill required.

Revision ID: a3f1c8e2d4b6
Revises: d7a3f1b9e2c8
Create Date: 2026-07-31
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a3f1c8e2d4b6"
down_revision: Union[str, Sequence[str], None] = "d7a3f1b9e2c8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("cells", schema=None) as batch_op:
        batch_op.add_column(sa.Column("internal_report_link", sa.String(length=1024), nullable=True))
        batch_op.add_column(sa.Column("internal_report_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("cells", schema=None) as batch_op:
        batch_op.drop_column("internal_report_at")
        batch_op.drop_column("internal_report_link")
