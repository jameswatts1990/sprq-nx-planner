from datetime import date, datetime

from pydantic import BaseModel


class CellUseHistoryOut(BaseModel):
    id: int
    run_batch_id: int
    cycle_id: int
    well: str
    status: str
    sample_id: int | None
    sample_external_id: str | None
    barcodes: list[str]
    instrument_serial: str | None
    started_at: datetime | None
    completed_at: datetime | None
    outcome_notes: str | None


class CellOut(BaseModel):
    id: int
    code: str
    max_uses: int
    status: str
    uses_consumed: int
    uses_remaining: int
    burned_barcodes: list[str]
    window_hours_elapsed: float | None
    window_breached: bool
    current_instrument_serial: str | None
    current_well: str | None
    last_use_run_date: date | None
    first_use_started_at: datetime | None
    created_at: datetime


class CellDetailOut(CellOut):
    use_history: list[CellUseHistoryOut] = []


class CellBootstrapRequest(BaseModel):
    uses_consumed: int = 0
    burned_barcodes: list[str] = []
    first_use_started_at: datetime | None = None
    instrument_serial: str | None = None
    actor: str | None = None
