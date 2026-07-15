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


class CycleOut(BaseModel):
    """One grid run: one instrument on one calendar day, with 1-8 filled wells (two trays of 4)."""

    cycle_id: int
    instrument_serial: str
    run_date: date
    movie_hours: int
    status: str
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


class ChangeCellRequest(BaseModel):
    """Reassign an already-placed sample to a different cell, same slot - see
    placement_service.change_cell."""

    cell_choice: CellChoice


class MoveSampleRequest(BaseModel):
    """Move an existing placement to a different (instrument, day, slot) in one atomic
    step - see placement_service.move_sample. Same-instrument-only is enforced server-side:
    a cell already in use elsewhere cannot be moved onto a different instrument."""

    instrument_serial: str
    run_date: date
    slot_index: int = Field(ge=0, le=7)
    run_time_hours: Literal[12, 24, 30]
    start_hour: int = Field(default=DAY_START_HOUR, ge=0, le=23)
    start_minute: int = Field(default=0, ge=0, le=59)


# --- auto-fill (POST /api/auto-fill) ---


class GridCellRef(BaseModel):
    instrument_serial: str
    run_date: date


class AutoFillRequest(BaseModel):
    cells: list[GridCellRef] = Field(min_length=1)
    max_uses: Literal[1, 2, 3] = 3  # target packing depth for new cells this batch (always honored in full,
    # subject only to how many distinct days are on offer); not a physical cap (always 3)
    run_time_hours: Literal[12, 24, 30] = 24
    objective: Literal["fewest", "balance", "fastest"] = "fewest"
    start_hour: int = Field(default=DAY_START_HOUR, ge=0, le=23)
    start_minute: int = Field(default=0, ge=0, le=59)


class AutoFillResponse(BaseModel):
    placed_sample_ids: list[int]
    unplaced_sample_ids: list[int]
    skipped_cells: list[GridCellRef]
    window_flags: list[WindowFlagOut]
    barcode_conflicts: list[BarcodeConflictOut]
    runs: list[CycleOut]
