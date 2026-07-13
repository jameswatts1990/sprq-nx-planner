"""Response/request shapes for the interactive grid scheduler.

Was schemas/schedule.py in the old preview/commit design; renamed now that the
Schedule concept is gone and a "run" is simply one (instrument, run_date) grid cell.
"""
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


class StageOut(BaseModel):
    slot_index: int  # WELLS.index(well); 0-3
    well: str
    cell_use_id: int
    cell_id: int
    cell_ref: str
    use_number: int  # 1-based position of this cell_use among its cell's loads - drives the Use 1/2/3 colour
    sample_id: int | None
    sample_external_id: str | None
    barcodes: list[str]


class CycleOut(BaseModel):
    """One grid run: one instrument on one calendar day, with 1-4 filled wells."""

    cycle_id: int
    instrument_serial: str
    run_date: date
    movie_hours: int
    status: str
    planned_start_at: datetime
    planned_end_at: datetime
    actual_start_at: datetime | None = None
    actual_end_at: datetime | None = None
    stages: list[StageOut] = []


class WindowFlagOut(BaseModel):
    cell_ref: str
    span_hours: float


# --- placement (POST /api/cell-uses) ---


class CellChoice(BaseModel):
    mode: Literal["new", "existing"]
    cell_id: int | None = None


class PlaceSampleRequest(BaseModel):
    sample_id: int
    instrument_serial: str
    run_date: date
    slot_index: int = Field(ge=0, le=3)
    cell_choice: CellChoice
    run_time_hours: Literal[12, 24, 30]
    max_uses: Literal[1, 2, 3] = 3


# --- auto-fill (POST /api/auto-fill) ---


class GridCellRef(BaseModel):
    instrument_serial: str
    run_date: date


class AutoFillRequest(BaseModel):
    cells: list[GridCellRef] = Field(min_length=1)
    max_uses: Literal[1, 2, 3] = 3
    run_time_hours: Literal[12, 24, 30] = 24
    objective: Literal["fewest", "balance", "fastest"] = "fewest"


class AutoFillResponse(BaseModel):
    placed_sample_ids: list[int]
    unplaced_sample_ids: list[int]
    skipped_cells: list[GridCellRef]
    window_flags: list[WindowFlagOut]
    runs: list[CycleOut]
