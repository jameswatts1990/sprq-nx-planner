from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


class RunDesignSettings(BaseModel):
    """Mirrors the prototype's "2 - Run design" controls exactly."""

    instrument_ids: list[str] = Field(min_length=1, max_length=4)  # instrument serial numbers
    max_uses: Literal[1, 2, 3] = 3
    run_time_hours: Literal[12, 24, 30] = 24
    objective: Literal["fewest", "balance", "fastest"] = "fewest"
    start_date: date


class ConflictPairOut(BaseModel):
    a: str
    b: str
    shared: list[str]


class WindowFlagOut(BaseModel):
    cell_ref: str
    span_hours: float


class KPIOut(BaseModel):
    total_acq: int
    fresh_cells: int
    prior_cells: int
    trays: int
    nx_cost: float
    single_cost: float
    savings: float
    savings_pct: int
    duration_days: int
    machines: int


class NotesOut(BaseModel):
    conflict_pairs: list[ConflictPairOut]
    unplaced_sample_ids: list[int]
    window_flags: list[WindowFlagOut]


class StageOut(BaseModel):
    cell_ref: str
    cell_id: int | None
    cell_is_prior: bool
    cell_use_id: int | None = None  # null on a live preview; set once persisted
    sample_id: int | None
    sample_external_id: str | None
    barcodes: list[str]
    well: str
    stage_no: int


class CycleOut(BaseModel):
    machine_idx: int
    instrument_serial: str
    batch_idx: int
    use_idx: int
    day_idx: int
    time_of_day_hours: float
    end_day_idx: int
    stages: list[StageOut]
    # populated once persisted (schedule detail responses); null on a live preview
    cycle_id: int | None = None
    status: str | None = None
    planned_start_at: datetime | None = None
    planned_end_at: datetime | None = None
    actual_start_at: datetime | None = None
    actual_end_at: datetime | None = None


class PackedCellUseOut(BaseModel):
    sample_id: int
    sample_external_id: str
    barcodes: list[str]


class PackedCellOut(BaseModel):
    cell_ref: str
    cell_id: int | None
    is_prior: bool
    burned_barcodes: list[str]
    future_uses: int
    total_uses: int
    cost_tier: int
    window_hours: float
    instrument_serial: str | None
    stage_no: int | None
    uses: list[PackedCellUseOut]


class PreviewRequest(BaseModel):
    settings: RunDesignSettings
    excluded_cell_ids: list[int] = []
    sample_ids: list[int] | None = None


class PreviewResponse(BaseModel):
    kpi: KPIOut
    notes: NotesOut
    cells: list[PackedCellOut]
    cycles: list[CycleOut]
    backlog_hash: str


class CommitRequest(BaseModel):
    settings: RunDesignSettings
    expected_backlog_hash: str
    excluded_cell_ids: list[int] = []
    sample_ids: list[int] | None = None
    actor: str | None = None


class ScheduleOut(BaseModel):
    id: int
    created_at: datetime
    created_by: str
    status: str
    start_date: date
    settings_json: dict
    kpi: KPIOut | None = None


class ScheduleDetailOut(ScheduleOut):
    cycles: list[CycleOut] = []
