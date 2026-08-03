"""rename internal report link -> id and add credit acquisitions

The internal-report stage now records the report ID the lab files the failure
under (e.g. 26_NC_S_004) rather than a link, so `internal_report_link` is
renamed to `internal_report_id` (any existing values carry over unchanged - an
old pasted link is still a string, just now shown as the report identifier).

The PacBio credit-confirmed stage now also records how many acquisitions PacBio
will credit, via a new nullable `credit_acquisitions` column.

Revision ID: c3e9a1f7b5d2
Revises: b7d2e9a1c3f4
Create Date: 2026-08-03
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3e9a1f7b5d2"
down_revision: Union[str, Sequence[str], None] = "b7d2e9a1c3f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("cells", schema=None) as batch_op:
        batch_op.alter_column(
            "internal_report_link",
            new_column_name="internal_report_id",
            existing_type=sa.String(length=1024),
            type_=sa.String(length=64),
            existing_nullable=True,
        )
        batch_op.add_column(sa.Column("credit_acquisitions", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("cells", schema=None) as batch_op:
        batch_op.drop_column("credit_acquisitions")
        batch_op.alter_column(
            "internal_report_id",
            new_column_name="internal_report_link",
            existing_type=sa.String(length=64),
            type_=sa.String(length=1024),
            existing_nullable=True,
        )
