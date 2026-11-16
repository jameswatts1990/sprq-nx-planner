"""The Schedule page's tray-panel feed: every cell of every physical tray that can still be on an
instrument in or after the viewed week, as slim ScheduleTrayCellOut rows.

Built from two column queries (cells+tray, uses+plate+run instrument) rather than the full cell
graph serialize_cell needs - the panel never reads reuse_ready_at, the per-run timing model that
makes the list endpoints heavy. The per-cell fields re-derive serialize_cell(as_of=None) exactly
(current_location, first_use_planned_start_at, cell_use_summary, ...) - keep them in step;
tests/integration/test_schedule_trays_api.py compares every field against GET /api/cells.

compute_tray_founding_dates / compute_tray_eviction_dates are Python twins of the frontend's
components/scheduler/waitingCells.ts (computeTrayFoundingDates / computeTrayEvictionDates); the
golden fixture frontend/src/components/scheduler/__fixtures__/schedule_trays_golden.json is asserted by both pytest and vitest, so
change both sides together."""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.engine.constants import CELL_TYPE_SPRQ, WELLS
from app.models.cell import Cell
from app.models.cell_tray import CellTray
from app.models.instrument import Instrument
from app.models.schedule import CellUse, Cycle, RunBatch
from app.schemas.cell import ScheduleTrayCellOut, ScheduleTrayUseOut
from app.timeutil import ensure_aware, utcnow

# A tray with a cell in one of these is always sent, however long ago it was evicted: an open
# cell feeds the Autoschedule drawer's reuse list, and a stopped one is a live QC case.
_ALWAYS_KEPT_STATUSES = ("open", "stopped")


class TrayCellLike(Protocol):
    """The fields the founding/eviction maps read - waitingCells.ts's TrayCellLike."""

    @property
    def tray_id(self) -> int | None: ...
    @property
    def first_use_started_at(self) -> datetime | None: ...
    @property
    def first_use_planned_start_at(self) -> datetime | None: ...
    @property
    def current_instrument_serial(self) -> str | None: ...
    @property
    def current_well(self) -> str | None: ...


def compute_tray_founding_dates(cells: Iterable[TrayCellLike]) -> dict[int, date]:
    """Earliest day any cell of each tray was scheduled for its own first use (confirmed start,
    else planned) - the day the tray became loaded. Twin of computeTrayFoundingDates."""
    dates: dict[int, date] = {}
    for cell in cells:
        if cell.tray_id is None:
            continue
        anchor = cell.first_use_started_at or cell.first_use_planned_start_at
        if anchor is None:
            continue
        # The calendar part as serialized - the frontend slices the ISO string's first 10 chars.
        day = anchor.date()
        existing = dates.get(cell.tray_id)
        if existing is None or day < existing:
            dates[cell.tray_id] = day
    return dates


def _position_group(well: str | None) -> int:
    """Carousel position of a well: 0 = A01-D01, 1 = A02-D02, -1 unknown (waitingCells.trayPositionGroup)."""
    if well not in WELLS:
        return -1
    return WELLS.index(well) // 4


def compute_tray_eviction_dates(
    cells: Iterable[TrayCellLike], founding_dates: dict[int, date]
) -> dict[int, date]:
    """For each tray, the founding day of the next tray founded in the same (instrument, carousel
    position) - the day it physically leaves. Trays with no successor are absent. Twin of
    computeTrayEvictionDates: the first cell seen per tray decides its position."""
    by_position: dict[tuple[str, int], list[tuple[date, int]]] = {}
    seen: set[int] = set()
    for cell in cells:
        if cell.tray_id is None or cell.tray_id in seen:
            continue
        if not cell.current_instrument_serial or not cell.current_well:
            continue
        group = _position_group(cell.current_well)
        if group < 0:
            continue
        founding = founding_dates.get(cell.tray_id)
        if founding is None:
            continue
        seen.add(cell.tray_id)
        by_position.setdefault((cell.current_instrument_serial, group), []).append((founding, cell.tray_id))

    evictions: dict[int, date] = {}
    for entries in by_position.values():
        foundings = sorted({founding for founding, _ in entries})
        for founding, tray_id in entries:
            successor = next((f for f in foundings if f > founding), None)
            if successor is not None:
                evictions[tray_id] = successor
    return evictions


def kept_tray_ids(cells: Iterable[ScheduleTrayCellOut], evictions: dict[int, date], date_from: date) -> set[int]:
    """Trays the Schedule needs from `date_from` on: any with an open or stopped cell, any not
    yet evicted, and any evicted after `date_from`. Whole trays only, so each kept tray's founding
    date is unchanged when the frontend recomputes it over the kept cells. So is an eviction after
    date_from: the successor founded that day is kept too. A tray kept only for its open/stopped
    cell may lose its (dropped) successor and re-derive a later eviction, but every tray between
    them was founded by date_from, so it stays <= date_from either way - and a tray evicted by
    date_from is never resident on a day the panel shows (residency needs the last day < eviction)."""
    statuses: dict[int, set[str]] = {}
    for cell in cells:
        if cell.tray_id is not None:
            statuses.setdefault(cell.tray_id, set()).add(cell.status)
    return {
        tray_id
        for tray_id, seen in statuses.items()
        if seen.intersection(_ALWAYS_KEPT_STATUSES) or tray_id not in evictions or evictions[tray_id] > date_from
    }


@dataclass(frozen=True)
class _UseRow:
    id: int
    status: str
    well: str
    started_at: datetime | None
    acquire_date: date | None
    planned_start_at: datetime | None
    instrument_serial: str | None


def _use_sort_key(use: _UseRow) -> tuple[date, int]:
    """cell_service.use_sort_key: acquire date (undated = distant past), then id."""
    return (use.acquire_date or date.min, use.id)


def _all_tray_cells(db: Session) -> list[ScheduleTrayCellOut]:
    """Every tray-linked cell, serialized as serialize_cell(as_of=None) would for these fields."""
    cell_rows = db.execute(
        select(
            Cell.id,
            Cell.code,
            Cell.cell_type,
            Cell.max_uses,
            Cell.status,
            Cell.tray_id,
            Cell.tray_position,
            Cell.home_well,
            Cell.first_use_started_at,
            CellTray.reuse_disabled_at,
            Instrument.serial_number,
        )
        .join(CellTray, Cell.tray_id == CellTray.id)
        .join(Instrument, CellTray.instrument_id == Instrument.id)
        # The same newest-first order GET /api/cells lists in; the eviction map reads each tray's
        # position off the first cell it meets.
        .order_by(Cell.created_at.desc(), Cell.id.desc())
    ).all()

    uses_by_cell: dict[int, list[_UseRow]] = {}
    use_rows = db.execute(
        select(
            CellUse.cell_id,
            CellUse.id,
            CellUse.status,
            CellUse.well,
            CellUse.started_at,
            Cycle.acquire_date,
            Cycle.planned_start_at,
            Instrument.serial_number,
        )
        .join(Cycle, CellUse.cycle_id == Cycle.id)
        .join(RunBatch, Cycle.run_batch_id == RunBatch.id)
        .join(Instrument, RunBatch.instrument_id == Instrument.id)
        .join(Cell, CellUse.cell_id == Cell.id)
        .where(Cell.tray_id.is_not(None))
    ).all()
    for row in use_rows:
        uses_by_cell.setdefault(row.cell_id, []).append(
            _UseRow(
                id=row.id,
                status=row.status,
                well=row.well,
                started_at=row.started_at,
                acquire_date=row.acquire_date,
                planned_start_at=row.planned_start_at,
                instrument_serial=row.serial_number,
            )
        )

    now = utcnow()
    out: list[ScheduleTrayCellOut] = []
    for c in cell_rows:
        uses = sorted(uses_by_cell.get(c.id, []), key=_use_sort_key)
        active = [u for u in uses if u.status != "cancelled"]
        last = active[-1] if active else None
        # cell_service.first_use_planned_start_at: earliest active use, undated ones sorting last.
        first = min(active, key=lambda u: (u.acquire_date or date.max, u.id)) if active else None
        # cell_service.current_location: the last use's instrument, else the tray's; the fixed
        # home well, else (legacy) the last use's loading well.
        instrument_serial = (last.instrument_serial if last else None) or c.serial_number
        well = c.home_well if c.home_well is not None else (last.well if last else None)
        elapsed = (
            (now - ensure_aware(c.first_use_started_at)).total_seconds() / 3600
            if c.first_use_started_at is not None and c.cell_type != CELL_TYPE_SPRQ
            else None
        )
        out.append(
            ScheduleTrayCellOut(
                id=c.id,
                code=c.code,
                cell_type=c.cell_type,
                max_uses=c.max_uses,
                status=c.status,
                uses_consumed=len(active),
                uses_remaining=max(0, c.max_uses - len(active)),
                window_hours_elapsed=elapsed,
                current_instrument_serial=instrument_serial,
                current_well=well,
                first_use_started_at=c.first_use_started_at,
                first_use_planned_start_at=first.planned_start_at if first else None,
                tray_id=c.tray_id,
                tray_position=c.tray_position,
                tray_reuse_disabled=c.reuse_disabled_at is not None,
                # cell_use_summary: every use (cancelled too - the panel filters those out),
                # anchored on its confirmed start, else its plate's planned start.
                uses=[
                    ScheduleTrayUseOut(
                        status=u.status,
                        breakout_anchor_at=ensure_aware(anchor)
                        if (anchor := u.started_at or u.planned_start_at)
                        else None,
                    )
                    for u in uses
                ],
            )
        )
    return out


def schedule_tray_cells(db: Session, date_from: date) -> list[ScheduleTrayCellOut]:
    """The whole trays the Schedule's tray panel and Autoschedule drawer need for a window
    starting `date_from` (see kept_tray_ids). The founding/eviction maps are computed over the
    full tray-linked universe, so a tray's eviction is known even when it's dropped."""
    cells = _all_tray_cells(db)
    founding = compute_tray_founding_dates(cells)
    evictions = compute_tray_eviction_dates(cells, founding)
    kept = kept_tray_ids(cells, evictions, date_from)
    return [c for c in cells if c.tray_id in kept]
