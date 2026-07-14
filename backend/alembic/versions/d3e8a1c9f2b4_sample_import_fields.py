"""add sample import fields

Adds columns to samples for extra Benchling export fields that were previously
dropped during import: Container ID, Adaptive Loading, Full Resolution Base Q,
Priority, CCS Output Includes Kinetics Information, and Target OPLC (distinct
from the existing Actual-OPLC-backed `oplc` column).

Revision ID: d3e8a1c9f2b4
Revises: a1f4c9d2b7e3
Create Date: 2026-07-14
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d3e8a1c9f2b4"
down_revision: Union[str, Sequence[str], None] = "a1f4c9d2b7e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.add_column(sa.Column("container_id", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("target_oplc", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("adaptive_loading", sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column("full_resolution_base_q", sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column("priority", sa.String(length=50), nullable=True))
        batch_op.add_column(sa.Column("ccs_kinetics", sa.String(length=20), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("samples", schema=None) as batch_op:
        batch_op.drop_column("ccs_kinetics")
        batch_op.drop_column("priority")
        batch_op.drop_column("full_resolution_base_q")
        batch_op.drop_column("adaptive_loading")
        batch_op.drop_column("target_oplc")
        batch_op.drop_column("container_id")
