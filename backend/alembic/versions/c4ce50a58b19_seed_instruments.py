"""seed instruments

Revision ID: c4ce50a58b19
Revises: f7bfcca3435c
Create Date: 2026-07-07 15:43:39.949883

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4ce50a58b19'
down_revision: Union[str, Sequence[str], None] = 'f7bfcca3435c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# The four Revio SPRQ-Nx instruments in service, per revio-nx-planner.html's INSTRUMENTS constant.
SERIAL_NUMBERS = ["84047", "84098", "84093", "84309"]

instruments_table = sa.table(
    "instruments",
    sa.column("serial_number", sa.String),
    sa.column("active", sa.Boolean),
)


def upgrade() -> None:
    op.bulk_insert(
        instruments_table,
        [{"serial_number": serial, "active": True} for serial in SERIAL_NUMBERS],
    )


def downgrade() -> None:
    op.execute(
        instruments_table.delete().where(instruments_table.c.serial_number.in_(SERIAL_NUMBERS))
    )
