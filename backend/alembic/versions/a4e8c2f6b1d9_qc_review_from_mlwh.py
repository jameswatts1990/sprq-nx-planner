"""QC Review: credit_source on both credit-case tables, mlwh_well_key on pacbio_cases, and
qc_review_ignores

The QC page's QC Review queue lists SMRT cells the QC team failed in LangQC (MLWH) that RunNx
hasn't failed (services/qc_review.py). A case raised from it is labelled "QC Review", so both kinds
of credit case get a nullable `credit_source` (null = started in RunNx, which every existing case
was). A case logged without a cell from the queue records the MLWH well it came from in
`pacbio_cases.mlwh_well_key` (unique - one well, one case), and `qc_review_ignores` holds the
wells the lab chose to ignore, with the reason. Schema only - no existing rows change.

Revision ID: a4e8c2f6b1d9
Revises: d5a1c7e3f9b2
Create Date: 2026-11-26
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a4e8c2f6b1d9"
down_revision: Union[str, Sequence[str], None] = "d5a1c7e3f9b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("cells", schema=None) as batch_op:
        batch_op.add_column(sa.Column("credit_source", sa.String(length=16), nullable=True))
    with op.batch_alter_table("pacbio_cases", schema=None) as batch_op:
        batch_op.add_column(sa.Column("credit_source", sa.String(length=16), nullable=True))
        batch_op.add_column(sa.Column("mlwh_well_key", sa.String(length=200), nullable=True))
        batch_op.create_unique_constraint("uq_pacbio_cases_mlwh_well_key", ["mlwh_well_key"])
    op.create_table(
        "qc_review_ignores",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("mlwh_well_key", sa.String(length=200), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("ignored_by", sa.String(length=120), nullable=True),
        sa.Column("ignored_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("mlwh_well_key"),
    )


def downgrade() -> None:
    op.drop_table("qc_review_ignores")
    with op.batch_alter_table("pacbio_cases", schema=None) as batch_op:
        batch_op.drop_constraint("uq_pacbio_cases_mlwh_well_key", type_="unique")
        batch_op.drop_column("mlwh_well_key")
        batch_op.drop_column("credit_source")
    with op.batch_alter_table("cells", schema=None) as batch_op:
        batch_op.drop_column("credit_source")
