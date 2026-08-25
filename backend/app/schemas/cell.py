from datetime import date, datetime

from pydantic import BaseModel


class CellUseHistoryOut(BaseModel):
    id: int
    run_batch_id: int
    cycle_id: int
    # Which plate (1 or 2) this use loaded on - the authoritative source for the plate-
    # qualified well label (P1_A01), since the stored `well` alone can't tell (a reuse Plate 2
    # stores A01-D01, the same letters as Plate 1).
    plate_index: int | None
    run_name: str | None
    well: str
    status: str
    sample_id: int | None
    sample_pool_id: str | None
    sample_priority: str | None
    sample_target_oplc: float | None
    sample_adaptive_loading: str | None
    sample_full_resolution_base_q: str | None
    sample_base_kinetics: str | None
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
    # Cell QC reconciliation flags (see services/qc_service.py): this use was shifted onto
    # this cell by a re-zip (reassigned), and/or now shares a burned barcode with another use
    # of this cell (barcode_clash).
    reassigned: bool = False
    barcode_clash: bool = False


class CellUseSummaryOut(BaseModel):
    """Compact per-use record carried on every CellOut (the list view), so a cell card can
    show which samples/runs the cell has been used by and link straight to each - without
    the caller having to fetch each cell's full detail. A leaner cousin of
    CellUseHistoryOut: just the identifiers the card links on, plus status so it can
    distinguish an already-run use from a still-scheduled one."""

    id: int
    run_batch_id: int
    run_name: str | None
    sample_id: int | None
    sample_pool_id: str | None
    well: str
    status: str
    # True once this use's run has reached/passed its scheduled start (see run_has_started) -
    # lets the card separate "has actually run" from "merely scheduled" the same way the
    # detail page does, rather than inferring it from status alone.
    run_started: bool
    # When this use's own run begins (its cell's started_at, else the plate's planned start) -
    # the load anchor from which this use's physical breakout is staggered. Lets a
    # reference-time-aware view (the schedule tray map's live "now" reading) count how many of a
    # cell's uses have actually broken out by a given instant, rather than counting every
    # scheduled use up front. None when the use has no cycle to anchor to.
    breakout_anchor_at: datetime | None = None


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
    # When the cell is physically free for its NEXT use = its most recent use's prep-aware movie
    # end (cell_service.cell_ready_at). Drives the weekly grid's "reusable from" ghost so it invites
    # the day the cell is actually free, not just the next weekday. None when the cell has no uses
    # yet or its last use's run isn't loaded.
    reuse_ready_at: datetime | None
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
    internal_report_id: str | None
    internal_report_at: datetime | None
    pacbio_case_number: str | None
    pacbio_reported_at: datetime | None
    pacbio_credit_confirmed_at: datetime | None
    credit_acquisitions: int | None
    credit_notes: str | None
    credit_received_at: datetime | None
    # Physical SPRQ-Nx SMRT Cell tray (4 cells) this cell belongs to - null for cells
    # created before this feature, or via the one-off bootstrap_cell() cutover tool.
    tray_id: int | None
    tray_position: int | None
    tray_size: int
    # Reversible "skip reuse / planning disposal" flag on this cell's physical tray - when
    # true, autoschedule/Recalculate won't reuse any cell in the tray (see
    # CellTray.reuse_disabled_at). Distinct from the sticky discard above.
    tray_reuse_disabled: bool
    # Compact history of the samples/runs this cell has been used by, chronological
    # (earliest use first). Powers the linked container/run list on the cell card.
    uses: list[CellUseSummaryOut] = []


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
    # Samples whose not-yet-run later use was re-homed onto another cell in the same tray
    # (the reshuffle-on-stop), and samples that no longer fit anywhere in the tray and can't
    # run - back in the backlog, surfaced as an alert. See cell_service.stop_cell.
    rehomed_sample_ids: list[int] = []
    unrunnable_sample_ids: list[int] = []


class CellUndoStopOut(BaseModel):
    cell: CellOut
    reverted_cell_use_ids: list[int] = []
    # cell_use ids whose sample had already moved on (requeued/rescheduled) since the
    # stop, so its status was deliberately left untouched rather than reverted.
    drifted_cell_use_ids: list[int] = []


class CellReportToPacbioRequest(BaseModel):
    case_number: str
    actor: str | None = None


class CellInternalReportRequest(BaseModel):
    # The report ID the failure is filed under internally (e.g. 26_NC_S_004).
    report_id: str
    actor: str | None = None


class CellConfirmCreditRequest(BaseModel):
    # Number of acquisitions PacBio confirmed they will credit for this case.
    acquisitions: int
    actor: str | None = None


class CellCreditNotesRequest(BaseModel):
    # Free-text note on the credit case, editable at any stage. Empty clears it.
    notes: str | None = None
    actor: str | None = None


class CellActorRequest(BaseModel):
    actor: str | None = None


class TrayDiscardRequest(BaseModel):
    tray_id: int
    reason: str | None = None
    actor: str | None = None


class TrayDiscardOut(BaseModel):
    cells: list[CellOut]


class TraySkipReuseRequest(BaseModel):
    tray_id: int
    # True = flag the tray "skip reuse / planning disposal"; False = clear the flag and
    # re-admit the tray to reuse. Reversible, advisory - see CellTray.reuse_disabled_at.
    disabled: bool
    actor: str | None = None


class TraySkipReuseOut(BaseModel):
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


class TrayRestoreRequest(BaseModel):
    tray_id: int
    actor: str | None = None


class TrayRestoreOut(BaseModel):
    # The tray's cells, now un-discarded (status re-derived from real capacity/window).
    cells: list[CellOut]
    # Uses moved back onto this tray from a reversed rotate's successor tray.
    reversed_use_ids: list[int]
    # Uses that couldn't be cleanly reversed (since confirmed-loaded, cancelled, or moved off the
    # successor tray) - left where they are, reported so the user knows what wasn't restored.
    drifted_use_ids: list[int]
    # The successor tray deleted because reversing emptied it (null if none/kept).
    deleted_tray_id: int | None = None
    # Another physical tray now resident in this tray's carousel bay - the user must resolve which
    # stays (null if the bay is clear).
    bay_conflict_tray_id: int | None = None
