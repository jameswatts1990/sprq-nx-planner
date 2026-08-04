"""add insert_size_bp to samples

Library insert / fragment size in base pairs (optional). Drives the "[<5kb]" card flag and
Auto Schedule's small-insert-on-first-use rule. Nullable addition - no backfill (a null reads
as "not recorded" and never counts as small-insert).

Revision ID: e2b8d4a1f6c3
Revises: e1c4a7d2f9b8
Create Date: 2026-08-04
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e2b8d4a1f6c3"
down_revision: Union[str, Sequence[str], None] = "e1c4a7d2f9b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.add_column(sa.Column("insert_size_bp", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.drop_column("insert_size_bp")
