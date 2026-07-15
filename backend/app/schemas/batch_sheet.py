"""Response shapes for the printable batch sheet - a per-day, per-instrument loading
sheet that gives a lab tech everything needed to physically load a Revio (which cell
goes in which well, which sample goes in which cell, what settings to dial in)."""
from datetime import date, datetime

from pydantic import BaseModel


class BatchSheetWellOut(BaseModel):
    well: str
    slot_index: int  # 0-3 = tray 1, 4-7 = tray 2
    cell_ref: str
    use_number: int  # 1-based Use 1/2/3 position, same derivation as StageOut.use_number
    cell_window_deadline: datetime | None  # cell.first_use_started_at + CELL_LIFETIME_H, if started
    window_breached: bool
    sample_id: int | None
    sample_external_id: str | None
    sample_container_id: str | None
    barcodes: list[str]
    adaptive_loading: str | None
    ccs_kinetics: str | None
    full_resolution_base_q: str | None
    target_oplc: float | None
    oplc: float | None
    volume: float | None


class BatchSheetInstrumentOut(BaseModel):
    instrument_serial: str
    instrument_name: str
    cycle_id: int
    movie_hours: int
    status: str
    planned_start_at: datetime
    planned_end_at: datetime
    wells: list[BatchSheetWellOut]


class BatchSheetOut(BaseModel):
    run_date: date
    instruments: list[BatchSheetInstrumentOut]
