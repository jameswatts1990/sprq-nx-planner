"""cell home well

Adds `cells.home_well`: the well (e.g. "C01") a cell is permanently pinned to within its
physical tray box from the moment its tray opens (see cell_service.open_new_tray()). Lets
a never-yet-used tray sibling surface a real current_well through current_location(), so
it renders in the weekly grid like any other reusable cell instead of only showing once
actually used.

Revision ID: c7f3a1e9d5b2
Revises: b2d6e9a4c1f7
Create Date: 2026-07-16
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c7f3a1e9d5b2"
down_revision: Union[str, Sequence[str], None] = "b2d6e9a4c1f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("cells", schema=None) as batch_op:
        batch_op.add_column(sa.Column("home_well", sa.String(length=8), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("cells", schema=None) as batch_op:
        batch_op.drop_column("home_well")
