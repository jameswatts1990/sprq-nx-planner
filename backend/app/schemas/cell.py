from datetime import date, datetime

from pydantic import BaseModel


class CellUseHistoryOut(BaseModel):
    id: int
    run_batch_id: int
    cycle_id: int
    run_name: str | None
    well: str
    status: str
    sample_id: int | None
    sample_external_id: str | None
    sample_priority: str | None
    sample_target_oplc: float | None
    sample_adaptive_loading: str | None
    sample_full_resolution_base_q: str | None
    sample_ccs_kinetics: str | None
    barcodes: list[str]
    instrument_serial: str | None
    started_at: datetime | None
    completed_at: datetime | None
    outcome_notes: str | None
    # True once this use's run has reached its scheduled start time (the instrument is
    # committed and a physical cell failure becomes possible), independent of whether
    # anyone has explicitly confirmed the run loaded yet.
    run_started: bool
    # True while a Failed/Aborted verdict on this use can still be undone - mirrors
    # run_service.undo_cell_use_status's own drift guard so the frontend can hide/disable
    # the Undo button instead of surfacing a 409 once the sample has moved on.
    undo_available: bool


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
    first_use_planned_start_at: datetime | None
    created_at: datetime
    # QC: stop (all future uses lost)
    stopped_reason: str | None
    stopped_at: datetime | None
    # Discard Cells (weekly schedule grid, per-tray) - forces status to "exhausted"
    # regardless of actual remaining use count.
    discarded_reason: str | None
    discarded_at: datetime | None
    # QC: PacBio credit tracking
    has_failed_use: bool
    needs_qc_report: bool
    awaiting_credit: bool
    pacbio_case_number: str | None
    pacbio_reported_at: datetime | None
    pacbio_credit_confirmed_at: datetime | None
    credit_received_at: datetime | None
    # Physical SPRQ-Nx SMRT Cell tray (4 cells) this cell belongs to - null for cells
    # created before this feature, or via the one-off bootstrap_cell() cutover tool.
    tray_id: int | None
    tray_position: int | None
    tray_size: int


class CellDetailOut(CellOut):
    use_history: list[CellUseHistoryOut] = []


class CellBootstrapRequest(BaseModel):
    uses_consumed: int = 0
    burned_barcodes: list[str] = []
    first_use_started_at: datetime | None = None
    instrument_serial: str | None = None
    actor: str | None = None


class CellStopRequest(BaseModel):
    reason: str | None = None
    actor: str | None = None
    # The specific use that triggered the stop (e.g. the slot the lab user was viewing) -
    # optional for a whole-cell Stop with no single use in view. See cell_service.stop_cell.
    cell_use_id: int | None = None


class CellStopOut(BaseModel):
    cell: CellOut
    bumped_sample_ids: list[int] = []


class CellUndoStopOut(BaseModel):
    cell: CellOut
    reverted_cell_use_ids: list[int] = []
    # cell_use ids whose sample had already moved on (requeued/rescheduled) since the
    # stop, so its status was deliberately left untouched rather than reverted.
    drifted_cell_use_ids: list[int] = []


class CellReportToPacbioRequest(BaseModel):
    case_number: str
    actor: str | None = None


class CellActorRequest(BaseModel):
    actor: str | None = None


class TrayDiscardRequest(BaseModel):
    tray_id: int
    reason: str | None = None
    actor: str | None = None


class TrayDiscardOut(BaseModel):
    cells: list[CellOut]


class TrayRotateRequest(BaseModel):
    tray_id: int
    # The grid day the rotate was triggered from: this day's uses and every later use of the
    # tray move onto the fresh tray; earlier uses stay on the old (discarded) cells.
    from_date: date
    reason: str | None = None
    actor: str | None = None


class TrayRotateOut(BaseModel):
    # The 4 cells of the freshly-minted tray.
    new_cells: list[CellOut]
    # How many uses were moved from the old tray onto the new one.
    moved_count: int
