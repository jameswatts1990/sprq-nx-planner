"""free-text notes on samples

One optional free-text note per sample, editable at any status (including finished samples) -
shown under the Pool ID on the Backlog's sample and resupply lists and on the sample's page.

NULLABLE with no backfill: existing samples simply have no note.

Revision ID: c3f8a1d6e2b9
Revises: b7d2e9f4a1c3
Create Date: 2026-11-06
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3f8a1d6e2b9"
down_revision: Union[str, Sequence[str], None] = "b7d2e9f4a1c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.add_column(sa.Column("notes", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.drop_column("notes")
