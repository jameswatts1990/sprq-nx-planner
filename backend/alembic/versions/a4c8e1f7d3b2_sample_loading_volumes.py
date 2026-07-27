"""batch-sheet loading dilution volumes on samples

Three optional per-sample loading-dilution volumes taken from the lab's scheduler sheet:
"Cleaned complex volume for desired OPLC (uL)", "Loading buffer volume (uL)" and
"Volume of Control Dilution 3 (uL)". They are importable (normal CSV mapping and the
"Upload from scheduler" route) and printed on the batch sheet's SOP 7.3 dilution worksheet,
but not surfaced or edited anywhere else.

All three columns are NULLABLE (no backfill): rows created before this migration — and any
import that omits them — simply read as null (blank on the batch sheet). Nullable avoids the
NOT-NULL-on-a-populated-table failure noted in CLAUDE.md.

Revision ID: a4c8e1f7d3b2
Revises: c1a7e4d9b2f6
Create Date: 2026-07-27
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a4c8e1f7d3b2"
down_revision: Union[str, Sequence[str], None] = "c1a7e4d9b2f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.add_column(sa.Column("cleaned_complex_volume", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("loading_buffer_volume", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("control_dilution_3_volume", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.drop_column("control_dilution_3_volume")
        batch_op.drop_column("loading_buffer_volume")
        batch_op.drop_column("cleaned_complex_volume")
