"""cell trays

Adds the CellTray entity: a physical SPRQ-Nx SMRT Cell tray of 4 cells, pinned to the
instrument it was loaded onto. `cells.tray_id`/`cells.tray_position` link each Cell to
its tray and 1-4 physical position; both nullable so cells created before this feature
(and the one-off bootstrap_cell() cutover cells, which have no known sibling history)
keep working with no tray.

Revision ID: b2d6e9a4c1f7
Revises: e6a2d4b8f1c3
Create Date: 2026-07-16
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2d6e9a4c1f7"
down_revision: Union[str, Sequence[str], None] = "e6a2d4b8f1c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "cell_trays",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("instrument_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False
        ),
        sa.ForeignKeyConstraint(["instrument_id"], ["instruments.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_cell_trays_instrument_id"), "cell_trays", ["instrument_id"], unique=False)

    with op.batch_alter_table("cells", schema=None) as batch_op:
        batch_op.add_column(sa.Column("tray_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("tray_position", sa.Integer(), nullable=True))
        batch_op.create_foreign_key("fk_cells_tray_id_cell_trays", "cell_trays", ["tray_id"], ["id"])
        batch_op.create_index(batch_op.f("ix_cells_tray_id"), ["tray_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("cells", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_cells_tray_id"))
        batch_op.drop_constraint("fk_cells_tray_id_cell_trays", type_="foreignkey")
        batch_op.drop_column("tray_position")
        batch_op.drop_column("tray_id")

    op.drop_index(op.f("ix_cell_trays_instrument_id"), table_name="cell_trays")
    op.drop_table("cell_trays")
