"""rename samples.external_id -> pool_id and samples.parent_sample -> plate_id

The sample identifier historically stored as `external_id` (surfaced to users as "Container
ID") is renamed to `pool_id` ("Pool ID"), and the optional `parent_sample` column
("Parent Sample") is renamed to `plate_id` ("Plate ID"), aligning the DB, API and UI with
the lab's own sequencing-tracker vocabulary. Data is preserved (a plain column rename); the
index on the identifier column is renamed to match.

dev.db note: SQLite renames columns via batch_alter_table (table copy). This is safe on
this project's disposable dev.db and preserves existing rows (a rename, not a NOT NULL add).

Revision ID: c2f9a4e1b7d3
Revises: e2b8d4a1f6c3
Create Date: 2026-08-11
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c2f9a4e1b7d3"
down_revision: Union[str, Sequence[str], None] = "e2b8d4a1f6c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The column rename and the (re)creation of its index are split across two batch blocks:
# on SQLite (batch = table copy) creating an index on the just-renamed column in the SAME
# block fails, because the new column name isn't yet visible to the index builder. Two
# blocks let the first commit the rename before the second indexes the new column. Both
# dialects run this correctly (on Postgres each block is a plain sequence of ALTERs).
def upgrade() -> None:
    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_samples_external_id"))
        batch_op.alter_column("external_id", new_column_name="pool_id")
        batch_op.alter_column("parent_sample", new_column_name="plate_id")
    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_samples_pool_id"), ["pool_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_samples_pool_id"))
        batch_op.alter_column("pool_id", new_column_name="external_id")
        batch_op.alter_column("plate_id", new_column_name="parent_sample")
    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_samples_external_id"), ["external_id"], unique=False)
