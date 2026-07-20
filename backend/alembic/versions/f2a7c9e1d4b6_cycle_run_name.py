"""add cycle run_name

Optional lab-assigned label for a run (e.g. Sanger's "TRACTION-RUN-1234"),
set when the run is locked (Confirm loaded) and overriding the plain cycle id
wherever a run is displayed. Nullable, no backfill needed.

Revision ID: f2a7c9e1d4b6
Revises: a9c1e7f4b6d2
Create Date: 2026-07-20
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f2a7c9e1d4b6"
down_revision: Union[str, Sequence[str], None] = "a9c1e7f4b6d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("cycles", schema=None) as batch_op:
        batch_op.add_column(sa.Column("run_name", sa.String(length=128), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("cycles", schema=None) as batch_op:
        batch_op.drop_column("run_name")
