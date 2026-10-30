"""volume of library pool used on samples

One optional per-sample volume (uL) that Traction asks for on each well: the volume of the
library pool taken to make the complex. Benchling exports it as "Volume of Library Pool Used
(uL)", the sequencing-tracker Google Sheet as "Library Volume Taken for Complex (uL)". It is
import-only (read-only in RunNx) and shown on the batch sheet and the sample detail page.

NULLABLE with no backfill: rows created before this migration, and any import that omits the
column, read as null ("not recorded").

Revision ID: b7d2e9f4a1c3
Revises: e5c1a9d3f7b2
Create Date: 2026-10-30
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7d2e9f4a1c3"
down_revision: Union[str, Sequence[str], None] = "e5c1a9d3f7b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.add_column(sa.Column("library_pool_volume_used", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.drop_column("library_pool_volume_used")
