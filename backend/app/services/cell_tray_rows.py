"""The Cells page's tray rows: serialized cells grouped into their physical trays, each with the
tray-level figures the row shows (instrument, first use, soonest window close, uses left), and
ordered for paging. Pure functions over CellOut - the API layer does the querying."""
from __future__ import annotations

from datetime import date, datetime, timedelta

from app.engine.constants import CELL_LIFETIME_H
from app.schemas.cell import CellOut, CellTrayRowOut
from app.timeutil import ensure_aware

TRAY_SORTS = ("expiry", "tray", "first_use", "last_run", "instrument", "uses_left")
SORT_DIRS = ("asc", "desc")


def _soonest_open_window(cells: list[CellOut]) -> tuple[float, datetime] | None:
    """(hours left, deadline) of the open cell whose 108h window closes first - the same
    "open and racing the clock" rule as the frontend's windowHoursRemaining."""
    soonest: tuple[float, datetime] | None = None
    for c in cells:
        if c.status != "open" or c.window_hours_elapsed is None or c.first_use_started_at is None:
            continue
        left = CELL_LIFETIME_H - c.window_hours_elapsed
        if soonest is None or left < soonest[0]:
            soonest = (left, ensure_aware(c.first_use_started_at) + timedelta(hours=CELL_LIFETIME_H))
    return soonest


def tray_row(tray_id: int | None, cells: list[CellOut], matched_ids: set[int]) -> CellTrayRowOut:
    cells = sorted(cells, key=lambda c: (c.tray_position or 0, c.id))
    soonest = _soonest_open_window(cells)
    first_uses = [
        ensure_aware(d) for c in cells if (d := c.first_use_started_at or c.first_use_planned_start_at) is not None
    ]
    last_runs = [c.last_use_run_date for c in cells if c.last_use_run_date is not None]
    return CellTrayRowOut(
        tray_id=tray_id,
        cell_type=cells[0].cell_type,
        instrument_serial=next((c.current_instrument_serial for c in cells if c.current_instrument_serial), None),
        first_use_at=min(first_uses, default=None),
        last_run_date=max(last_runs, default=None),
        expires_in_hours=soonest[0] if soonest else None,
        expires_at=soonest[1] if soonest else None,
        uses_left=sum(max(0, c.uses_remaining - c.uses_scheduled_later) for c in cells if c.status == "open"),
        reuse_disabled=any(c.tray_reuse_disabled for c in cells),
        cells=cells,
        matched_cell_ids=[c.id for c in cells if c.id in matched_ids],
    )


def group_tray_rows(matched: list[CellOut], siblings: list[CellOut]) -> list[CellTrayRowOut]:
    """One row per tray across the matched cells plus their unmatched tray-mates; a trayless
    (bootstrap/legacy) cell is a row on its own."""
    matched_ids = {c.id for c in matched}
    by_tray: dict[int, list[CellOut]] = {}
    rows: list[CellTrayRowOut] = []
    for c in [*matched, *siblings]:
        if c.tray_id is None:
            rows.append(tray_row(None, [c], matched_ids))
        else:
            by_tray.setdefault(c.tray_id, []).append(c)
    rows.extend(tray_row(tray_id, cells, matched_ids) for tray_id, cells in by_tray.items())
    return rows


def _sort_value(row: CellTrayRowOut, key: str) -> float | int | str | date | datetime | None:
    if key == "tray":
        return row.tray_id
    if key == "expiry":
        return row.expires_in_hours
    if key == "first_use":
        return row.first_use_at
    if key == "last_run":
        return row.last_run_date
    if key == "instrument":
        return row.instrument_serial
    return row.uses_left


def sort_tray_rows(rows: list[CellTrayRowOut], key: str, direction: str) -> list[CellTrayRowOut]:
    """Order rows by `key`. Rows with no value (no open window, never used, …) always trail
    whichever way the sort runs, and equal values fall back to newest tray first - applied
    before the stable keyed sort so the tie-break holds in both directions."""
    rows = sorted(rows, key=lambda r: (r.tray_id is None, -(r.tray_id or 0), -r.cells[0].id))
    valued = [r for r in rows if _sort_value(r, key) is not None]
    missing = [r for r in rows if _sort_value(r, key) is None]
    valued.sort(key=lambda r: _sort_value(r, key), reverse=direction == "desc")
    return valued + missing
