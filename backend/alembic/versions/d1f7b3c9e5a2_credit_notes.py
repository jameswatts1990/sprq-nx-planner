"""add credit notes to the PacBio credit-confirmed step

An optional free-text note captured alongside the credited-acquisitions count at
the confirm step (e.g. what PacBio agreed to). Nullable addition - no backfill.

Revision ID: d1f7b3c9e5a2
Revises: c3e9a1f7b5d2
Create Date: 2026-08-03
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d1f7b3c9e5a2"
down_revision: Union[str, Sequence[str], None] = "c3e9a1f7b5d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("cells", schema=None) as batch_op:
        batch_op.add_column(sa.Column("credit_notes", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("cells", schema=None) as batch_op:
        batch_op.drop_column("credit_notes")
