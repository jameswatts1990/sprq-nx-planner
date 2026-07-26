"""cell code tray format

Backfills existing cell codes to the new tray-tied format: `CELL-{A-D}{id:06d}` becomes
`C{tray_position:02d}-T{tray_id}` (e.g. CELL-A000042 -> C01-T123), so a tray's four cells
read C01-T123 .. C04-T123 and the tray id is visible in every cell's own id. Plates are
lettered, cells are numbered - see cell_service.open_new_tray() (which now mints this
format for new cells) and docs/pacbio-sprq-nx-scheduling-reference.md's vocabulary map.

Only tray-linked cells are touched (tray_id + tray_position both set). Bootstrap-cutover /
legacy cells with no tray keep their existing code (BOOT-<ts> / CELL-<letter><id>), same as
open_new_tray leaves them.

This is a pure UPDATE of an existing column - no schema change - so it is safe on a
populated dev.db (unlike a NOT NULL column add). `cells.code` is String(32); the new form
fits and stays globally unique (tray_id + tray_position is unique per cell, and the new
namespace can't collide with CELL-/BOOT- codes). Done as a Python loop over the bind so it
runs identically on SQLite (dev) and Postgres (prod) without dialect-specific string SQL.

Revision ID: f3b9c1a7e2d5
Revises: a4f8c2e6b9d3
Create Date: 2026-07-26
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = "f3b9c1a7e2d5"
down_revision: Union[str, Sequence[str], None] = "a4f8c2e6b9d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tray_cells(conn):
    return conn.execute(
        text(
            "SELECT id, tray_id, tray_position FROM cells "
            "WHERE tray_id IS NOT NULL AND tray_position IS NOT NULL"
        )
    ).fetchall()


def upgrade() -> None:
    conn = op.get_bind()
    for row in _tray_cells(conn):
        code = f"C{row.tray_position:02d}-T{row.tray_id}"
        conn.execute(text("UPDATE cells SET code = :code WHERE id = :id"), {"code": code, "id": row.id})


def downgrade() -> None:
    conn = op.get_bind()
    for row in _tray_cells(conn):
        letter = chr(64 + row.tray_position)  # 1 -> "A" .. 4 -> "D"
        code = f"CELL-{letter}{row.id:06d}"
        conn.execute(text("UPDATE cells SET code = :code WHERE id = :id"), {"code": code, "id": row.id})
