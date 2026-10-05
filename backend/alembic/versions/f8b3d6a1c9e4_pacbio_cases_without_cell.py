"""pacbio_cases: PacBio credit cases logged without a RunNx cell

A new table for credit cases with no cell behind them (models/pacbio_case.py), logged by hand
from the QC page. Carries the same credit-stage columns as cells (CreditCaseMixin) plus the
hand-entered context a cell's case would otherwise derive from its failed use. A new table
only - no change to existing rows, safe on a populated dev.db and on Postgres.

Revision ID: f8b3d6a1c9e4
Revises: c2f9a4e1b7d3
Create Date: 2026-10-05
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f8b3d6a1c9e4"
down_revision: Union[str, Sequence[str], None] = "c2f9a4e1b7d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "pacbio_cases",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("summary", sa.String(length=200), nullable=False),
        sa.Column("occurred_on", sa.Date(), nullable=False),
        sa.Column("instrument_id", sa.Integer(), nullable=True),
        sa.Column("run_name", sa.String(length=120), nullable=True),
        sa.Column("pool_id", sa.String(length=120), nullable=True),
        sa.Column("expected_acquisitions", sa.Integer(), nullable=True),
        sa.Column("created_by", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("internal_report_id", sa.String(length=64), nullable=True),
        sa.Column("internal_report_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pacbio_case_number", sa.String(length=64), nullable=True),
        sa.Column("pacbio_reported_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pacbio_credit_confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("credit_acquisitions", sa.Integer(), nullable=True),
        sa.Column("credit_notes", sa.Text(), nullable=True),
        sa.Column("credit_received_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["instrument_id"], ["instruments.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_pacbio_cases_pacbio_case_number", "pacbio_cases", ["pacbio_case_number"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_pacbio_cases_pacbio_case_number", table_name="pacbio_cases")
    op.drop_table("pacbio_cases")
