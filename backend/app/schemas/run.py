"""Response/request shapes for the interactive grid scheduler.

Was schemas/schedule.py in the old preview/commit design; renamed now that the
Schedule concept is gone and a "run" is simply one (instrument, run_date) grid cell.
"""
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.engine.constants import DAY_START_HOUR


class StageOut(BaseModel):
    slot_index: int  # WELLS.index(well); 0-7 (tray 1: 0-3, tray 2: 4-7)
    well: str
    cell_use_id: int
    cell_id: int
    cell_ref: str
    use_number: int  # 1-based position of this cell_use among its cell's loads - drives the Use 1/2/3 colour
    sample_id: int | None
    sample_external_id: str | None
    barcodes: list[str]
    # This specific use's own status (planned/started/completed/failed/cancelled) and the
    # physical cell's overall status (open/exhausted/window_expired/retired/stopped) - lets
    # the grid flag a QC problem (a failed use, or a now-stopped cell) directly on the slot
    # without a click-through to the cell's detail page.
    cell_use_status: str
    cell_status: str
    # True if *any* use of this cell has a recorded "failed" outcome - lets the grid tell
    # apart an earlier, still-untouched use (still "planned"/"started", no outcome of its
    # own yet) from the one a Stop cell was actually triggered from once a cell goes
    # "stopped": stop_cell() always marks its triggering use "failed", so if that's
    # present anywhere on the cell, every other non-terminal use is provably untouched
    # history and must not be repainted "Stopped" (see SchedulerSlotView's qcAlert).
    cell_has_failed_use: bool
    # Physical SPRQ-Nx SMRT Cell tray position (1-4), null for cells with no tray (created
    # before this feature, or via the one-off bootstrap_cell() cutover tool).
    tray_position: int | None
    # The physical tray this cell belongs to - lets the grid's per-tray "Discard Cells"
    # action target every sibling cell, not just the ones with a filled slot this cycle.
    tray_id: int | None
    # Hours elapsed since this cell's own first use (None if not started yet) - drives the
    # grid slot's expiry shading, per-cell (see docs/pacbio-sprq-nx-scheduling-reference.md
    # #2 - there is no shared tray-level clock, only this cell's own 108h deadline).
    window_hours_elapsed: float | None


class CycleOut(BaseModel):
    """One grid run: one instrument on one calendar day, with 1-8 filled wells (two trays of 4)."""

    cycle_id: int
    instrument_serial: str
    run_date: date
    movie_hours: int
    status: str
    run_name: str | None = None
    planned_start_at: datetime
    planned_end_at: datetime
    actual_start_at: datetime | None = None
    actual_end_at: datetime | None = None
    lock_until: datetime  # planned_start_at + movie_hours + LOCK_BUFFER_HOURS
    is_locked: bool  # "now" falls within [planned_start_at, lock_until) and status isn't aborted/completed
    stages: list[StageOut] = []


class WindowFlagOut(BaseModel):
    cell_ref: str
    span_hours: float


class BarcodeConflictOut(BaseModel):
    """Two backlog samples in this batch share a barcode - surfaced so a barcode clash
    is visible before placement, not just blocked at persist time. Read-only visibility:
    the existing same-cell burned-barcode 409 guard is what actually prevents an unsafe
    reuse when either sample is later placed."""

    sample_external_id_a: str
    sample_external_id_b: str
    shared_barcodes: list[str]


# --- placement (POST /api/cell-uses) ---


class CellChoice(BaseModel):
    mode: Literal["new", "existing"]
    cell_id: int | None = None


class PlaceSampleRequest(BaseModel):
    sample_id: int
    instrument_serial: str
    run_date: date
    slot_index: int = Field(ge=0, le=7)
    cell_choice: CellChoice
    run_time_hours: Literal[12, 24, 30]
    # Only meaningful the first time a sample is placed into an empty (instrument, day)
    # grid cell - that's what actually creates the run and fixes its start time. Ignored
    # (the run's existing start stands) when placing into an already-existing run.
    start_hour: int = Field(default=DAY_START_HOUR, ge=0, le=23)
    start_minute: int = Field(default=0, ge=0, le=59)


class MoveSampleRequest(BaseModel):
    """Move an existing placement to a different (instrument, day, slot) - see
    placement_service.move_sample. If the destination well conflicts with the cell's own
    established pin (a different well than its other uses), OR a different physical cell
    is already resident in that exact destination well (e.g. an eagerly-opened tray
    sibling), the dragged cell can't go there and `cell_choice` resolves which different
    cell the sample lands on instead, exactly like a fresh placement; omit it only for a
    genuine same-cell reschedule, where the destination well is still this cell's own."""

    instrument_serial: str
    run_date: date
    slot_index: int = Field(ge=0, le=7)
    run_time_hours: Literal[12, 24, 30]
    start_hour: int = Field(default=DAY_START_HOUR, ge=0, le=23)
    start_minute: int = Field(default=0, ge=0, le=59)
    cell_choice: CellChoice | None = None


# --- auto-fill (POST /api/auto-fill) ---


class GridCellRef(BaseModel):
    instrument_serial: str
    run_date: date


class AutoFillRequest(BaseModel):
    cells: list[GridCellRef] = Field(min_length=1)
    max_uses: Literal[1, 2, 3] = 3  # target packing depth for new cells this batch (always honored in full,
    # subject only to how many distinct days are on offer); not a physical cap (always 3)
    run_time_hours: Literal[12, 24, 30] = 24
    objective: Literal["fewest", "balance", "fastest", "utilisation"] = "fewest"
    # 4 = tray 1 only; 8 = both trays. Caps how many of a run's 8 wells auto-fill will use
    # per instrument-day - see engine/slot_scheduling.py::fill_slots.
    cells_per_day: Literal[4, 8] = 8
    start_hour: int = Field(default=DAY_START_HOUR, ge=0, le=23)
    start_minute: int = Field(default=0, ge=0, le=59)


class AutoFillResponse(BaseModel):
    placed_sample_ids: list[int]
    unplaced_sample_ids: list[int]
    skipped_cells: list[GridCellRef]
    window_flags: list[WindowFlagOut]
    barcode_conflicts: list[BarcodeConflictOut]
    runs: list[CycleOut]
