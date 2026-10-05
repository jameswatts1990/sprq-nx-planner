"""credit_owner on both kinds of PacBio credit case

Who is chasing a credit case (free text - a Sanger ID or a name), shared by cells and
pacbio_cases via CreditCaseMixin. Nullable addition - no backfill.

Revision ID: a6d2c8f4e1b9
Revises: f8b3d6a1c9e4
Create Date: 2026-10-05
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a6d2c8f4e1b9"
down_revision: Union[str, Sequence[str], None] = "f8b3d6a1c9e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("cells", "pacbio_cases")


def upgrade() -> None:
    for table in _TABLES:
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.add_column(sa.Column("credit_owner", sa.String(length=120), nullable=True))


def downgrade() -> None:
    for table in _TABLES:
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.drop_column("credit_owner")
