"""Response shapes for the printable batch sheet - a per-load-day loading sheet that gives
a lab tech everything needed to physically load a Revio run in one session: one section per
run, its 1-2 plates (each with its own acquisition date), and for each well which cell/sample
goes where and what settings to dial in. Both plates print on the load day, so a reuse run's
Plate 2 (which the instrument auto-runs the next day) is no longer missing from the sheet."""
from datetime import date, datetime

from pydantic import BaseModel


class BatchSheetWellOut(BaseModel):
    well: str
    slot_index: int  # grid position 0-7 (Plate 1: 0-3, Plate 2: 4-7)
    plate_number: int  # 1 or 2 - which plate this well is on
    cell_ref: str
    use_number: int  # 1-based Use 1/2/3 position, same derivation as StageOut.use_number
    run_time_hours: int  # this well's own movie / run time (12/24/30) - per-cell, may differ within a run
    cell_window_deadline: datetime | None  # cell.first_use_started_at + CELL_LIFETIME_H, if started
    window_breached: bool
    sample_id: int | None
    sample_external_id: str | None
    barcodes: list[str]
    adaptive_loading: str | None
    ccs_kinetics: str | None
    full_resolution_base_q: str | None
    target_oplc: float | None
    volume: float | None
    notes: str | None  # free-text placement note, printed alongside the well


class BatchSheetPlateOut(BaseModel):
    plate_number: int  # 1 or 2
    acquire_date: date  # the day this plate sequences (Plate 1 == the run's load day)
    is_reuse: bool  # True = reuses Plate 1's cells on a later day (sequential); False = Plate 1 or a fresh parallel Plate 2
    movie_hours: int
    wells: list[BatchSheetWellOut]


class BatchSheetRunOut(BaseModel):
    instrument_serial: str
    instrument_name: str
    run_id: int
    run_name: str | None
    load_date: date
    status: str
    plates: list[BatchSheetPlateOut]


class BatchSheetOut(BaseModel):
    load_date: date
    runs: list[BatchSheetRunOut]
