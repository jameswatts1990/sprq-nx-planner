"""app_settings.value: String(255) -> Text

The editable PacBio credit-email template stores its body under `credit_email.body`,
which runs to several hundred characters. SQLite ignores the varchar length so dev.db is
unaffected, but production Postgres enforces varchar(255) and would reject/truncate the
body — so widen the column to Text.

Widening only (no NOT NULL / default change), so existing rows migrate cleanly. SQLite
performs the type change via batch_alter_table (table copy); safe on the disposable dev.db.

Revision ID: e1c4a7d2f9b8
Revises: d1f7b3c9e5a2
Create Date: 2026-08-04
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e1c4a7d2f9b8"
down_revision: Union[str, Sequence[str], None] = "d1f7b3c9e5a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("app_settings", schema=None) as batch_op:
        batch_op.alter_column(
            "value",
            existing_type=sa.String(length=255),
            type_=sa.Text(),
            existing_nullable=True,
        )


def downgrade() -> None:
    with op.batch_alter_table("app_settings", schema=None) as batch_op:
        batch_op.alter_column(
            "value",
            existing_type=sa.Text(),
            type_=sa.String(length=255),
            existing_nullable=True,
        )
