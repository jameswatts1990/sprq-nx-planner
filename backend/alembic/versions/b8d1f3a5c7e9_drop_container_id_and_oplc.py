"""drop samples.container_id and samples.oplc

Removes the separate Plate ID / Container column (`container_id`) and the actual
loading-concentration column (`oplc`) from `samples`. The sample identifier previously
labelled "External ID" is now surfaced to users as "Container ID" (backed by the
unchanged `external_id` column), and only the Target OPLC is kept.

dev.db note: SQLite drops columns via batch_alter_table (table copy). This is safe on
this project's disposable dev.db; no data of record lives in these columns.

Revision ID: b8d1f3a5c7e9
Revises: f2a7c9e1d4b6
Create Date: 2026-07-23
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b8d1f3a5c7e9"
down_revision: Union[str, Sequence[str], None] = "f2a7c9e1d4b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.drop_column("oplc")
        batch_op.drop_column("container_id")


def downgrade() -> None:
    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.add_column(sa.Column("container_id", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("oplc", sa.Float(), nullable=True))
