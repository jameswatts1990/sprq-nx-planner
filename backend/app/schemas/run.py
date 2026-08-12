"""Response/request shapes for the interactive grid scheduler.

A "run" is now a SMRT Link run design: one physical load session on one instrument
(RunOut, keyed by load_date), holding 1-2 plates (PlateOut, each an acquisition round with
its own acquire_date). Was schemas/schedule.py, then the flat per-(instrument, day) CycleOut;
the Run->Plate split nests plates under a run so a reuse run reads as one run.
"""
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.engine.constants import DAY_START_HOUR


class StageOut(BaseModel):
    # Grid POSITION within the run, 0-7: Plate 1 -> 0-3, Plate 2 -> 4-7. Deliberately NOT
    # WELLS.index(well) any more: a reuse Plate 2 sits in the same physical wells (A01-D01)
    # as Plate 1, so `well` repeats across the two plates - position is derived from the
    # plate plus the well's letter, while `well` below stays the true SMRT Link label.
    slot_index: int
    well: str  # the plate LOADING position this sample was dropped onto (drives slot_index)
    cell_use_id: int
    cell_id: int
    cell_ref: str
    # The physical cell's own tray identity well (A01-D01 / A02-D02) - its fixed A/B/C/D tray
    # position, distinct from `well` (the loading slot). Drives the card's ticket-stub letter
    # (e.g. "B1" = tray position B, Use 1) so the stub names the real cell even when the sample
    # sits in a different plate slot. Null for a legacy/bootstrap cell with no tray.
    cell_home_well: str | None
    use_number: int  # 1-based position of this cell_use among its cell's loads - drives the Use 1/2/3 colour
    # The physical cell's own use cap (usually 3, the vendor cap; lower only if QC reduced it).
    # With use_number, gives the cell's remaining uses (cell_max_uses - use_number) - what the
    # Instruments tab's Revio-screen panel shows in its "Remaining SMRT Cell uses" boxes.
    cell_max_uses: int = 3
    # This well's own movie / run time in hours (12/24/30). Per-cell: different wells of one
    # run may differ, editable from the slot-detail popover. The plate-level PlateOut.movie_hours
    # is the longest of these (see PlateOut.movie_hours).
    run_time_hours: int
    sample_id: int | None
    sample_pool_id: str | None
    # Library insert / fragment size (bp) of the sample in this slot, or null if not recorded.
    # Drives the grid card's "[<5kb]" flag and the small-insert-on-reuse warning (a small-insert
    # sample sitting on use_number >= 2). Threshold is admin-configurable (read client-side).
    insert_size_bp: int | None = None
    # Duplicate marker for the sample in this slot: when its Pool ID appears on more than
    # one sample (any status), duplicate_total is the count and duplicate_index this copy's
    # 1-based position. Both null for a one-off — the grid card shows the "1/3" badge only when set.
    duplicate_index: int | None = None
    duplicate_total: int | None = None
    # True when this cell was already used by another copy of the exact same Pool ID
    # (a sibling duplicate sharing a barcode) - an intentionally ALLOWED reuse (see
    # cell_service.foreign_barcode_clash / docs/pacbio-sprq-nx-scheduling-reference.md), shown
    # so it's transparent at a glance rather than a silent exception to the barcode-clash rule.
    duplicate_cell_reuse: bool = False
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
    # Advisory only, never blocks a placement - hours by which this use's own start preceded
    # its cell's real physical readiness (the immediately-prior use's movie end + the on-board
    # reuse wash). None when this is the cell's first use, or the start was already safely
    # at/after readiness. A distinct clock from window_hours_elapsed's 108h lifetime check -
    # see docs/pacbio-sprq-nx-scheduling-reference.md's "Deliberate simplifications". Only
    # populated on placement/move/auto-fill responses (see run_serializer.run_out's
    # with_effective_start), None on the plain grid feed.
    reuse_not_ready_hours: float | None = None
    # Free-text note the user attached to this sample-on-this-cell placement, shown (and
    # editable) in the slot-detail popover. Distinct from the QC outcome_notes field.
    notes: str | None = None
    # Cell QC reconciliation (see services/qc_service.py): `reassigned` is True when a QC
    # tray re-zip shifted this acquisition onto a different physical cell than planned;
    # `barcode_clash` is True when it now shares a burned barcode with another use of that
    # cell. Both drive a grid warning so a shifted/compromised sample is visible at a glance.
    reassigned: bool = False
    barcode_clash: bool = False


class PlateOut(BaseModel):
    """One acquisition round within a run (a persisted Cycle). Up to 4 wells."""

    plate_id: int  # the Cycle id
    plate_index: int  # 1 or 2 - which sample plate / loading position
    acquire_date: date  # the day THIS plate sequences (== run.load_date for Plate 1)
    # True when this plate reuses an earlier plate's cells (same tray, a later acquire_date,
    # after the on-board wash) - i.e. its wells show Use >= 2. False for Plate 1 and for a
    # fresh parallel Plate 2 (a second tray acquiring the same day as Plate 1).
    is_reuse: bool
    # This plate's representative run time: the longest of its wells' per-cell run_time_hours.
    movie_hours: int
    status: str
    planned_start_at: datetime
    planned_end_at: datetime
    actual_start_at: datetime | None = None
    actual_end_at: datetime | None = None
    stages: list[StageOut] = []


class RunOut(BaseModel):
    """One SMRT Link run design: one load session on one instrument, holding 1-2 plates
    (up to 8 cells). Plate 1 acquires on load_date; Plate 2 acquires the same day (fresh
    second tray, parallel) or a later day (reuse of Plate 1's cells)."""

    run_id: int  # the RunBatch id
    instrument_serial: str
    load_date: date  # the day the whole run is physically loaded (one session)
    run_name: str | None = None  # run-level Traction ID, set at Confirm loaded
    # Derived run-level status (see run_serializer): "running"/"completed" once its plates
    # are, else "planned". A run's plates are all loaded together, so this tracks the load.
    status: str
    lock_until: datetime  # the instrument is held until the last plate's acquisition finishes + buffer
    is_locked: bool  # "now" falls within the run's load->last-acquisition window and it isn't aborted/completed
    # Derived, never stored (cell_timing.instrument_timeline): when this run's cells actually break
    # out once the instrument's OTHER resident runs' sequencing-lane occupancy is accounted for. The
    # user's chosen load time still stands (plates[0].planned_start_at); if the machine is busy the
    # cells simply queue, and effective_start_at says until when. Only populated on placement/move/
    # auto-fill responses (None on the grid feed, to avoid a per-row query). starts_later_than_requested
    # is true when effective_start_at is meaningfully later than the load - the cue to alert the user.
    effective_start_at: datetime | None = None
    starts_later_than_requested: bool = False
    plates: list[PlateOut] = []


class WindowFlagOut(BaseModel):
    cell_ref: str
    span_hours: float


class BarcodeConflictOut(BaseModel):
    """Two backlog samples in this batch share a barcode - surfaced so a barcode clash
    is visible before placement, not just blocked at persist time. Read-only visibility:
    the existing same-cell burned-barcode 409 guard is what actually prevents an unsafe
    reuse when either sample is later placed."""

    sample_pool_id_a: str
    sample_pool_id_b: str
    shared_barcodes: list[str]


# --- placement (POST /api/cell-uses) ---


class CellChoice(BaseModel):
    mode: Literal["new", "existing"]
    cell_id: int | None = None


class PlaceSampleRequest(BaseModel):
    sample_id: int
    instrument_serial: str
    load_date: date  # the run's load day (the grid column the sample is dropped into)
    # Grid position 0-7 within the run: 0-3 = Plate 1, 4-7 = Plate 2. For a reuse Plate 2
    # drop (an existing cell already used in Plate 1), the backend derives a later acquire_date.
    slot_index: int = Field(ge=0, le=7)
    # Omit (null) to let the engine DERIVE the cell (reuse-before-new, same rule as auto-fill -
    # see placement_service.derive_best_cell); this is what a plain drag-drop sends. An explicit
    # {"new"|"existing"} overrides that (the cell-stub's "use a different cell" path).
    cell_choice: CellChoice | None = None
    # Omit (null) to inherit the sample's own movie time (Sample.movie_time_hours, default
    # 24h) - this is what a plain drag-drop now sends, so a sample runs for the movie time it
    # was imported/edited with. An explicit value overrides it (e.g. a re-place that keeps an
    # existing per-cell run time). See placement_service.place_sample.
    run_time_hours: Literal[12, 24, 30] | None = None
    # Only meaningful the first time a sample is placed into an empty (instrument, load_date)
    # grid cell - that's what actually creates the run and fixes its start time. Ignored
    # (the run's existing start stands) when placing into an already-existing run/plate.
    start_hour: int = Field(default=DAY_START_HOUR, ge=0, le=23)
    start_minute: int = Field(default=0, ge=0, le=59)


class MoveSampleRequest(BaseModel):
    """Move an existing placement to a different (instrument, load_date, slot). See
    placement_service.move_sample. If the destination well conflicts with the cell's own
    established pin (a different well than its other uses), OR a different physical cell
    is already resident in that exact destination well (e.g. an eagerly-opened tray
    sibling), the dragged cell can't go there and `cell_choice` resolves which different
    cell the sample lands on instead, exactly like a fresh placement; omit it only for a
    genuine same-cell reschedule, where the destination well is still this cell's own."""

    instrument_serial: str
    load_date: date
    slot_index: int = Field(ge=0, le=7)
    run_time_hours: Literal[12, 24, 30]
    start_hour: int = Field(default=DAY_START_HOUR, ge=0, le=23)
    start_minute: int = Field(default=0, ge=0, le=59)
    cell_choice: CellChoice | None = None


# --- auto-fill (POST /api/auto-fill) ---


class GridCellRef(BaseModel):
    instrument_serial: str
    load_date: date


class AutoFillRequest(BaseModel):
    cells: list[GridCellRef] = Field(min_length=1)
    max_uses: Literal[1, 2, 3] = 3  # target packing depth for new cells this batch (always honored in full,
    # subject only to how many distinct days are on offer); not a physical cap (always 3)
    # Movie times (12/24/30) the user ticked in the Autoschedule panel: only backlog samples of
    # these movie lengths are auto-scheduled this batch, and each placed well runs for its own
    # sample's movie time (a run may mix them). Defaults to just 24h (the everyday case). 12h
    # samples are confined to cell 1 and 30h samples to cell 4 - see auto_fill_service and
    # engine/slot_scheduling.fill_slots.
    movie_times: list[Literal[12, 24, 30]] = Field(default_factory=lambda: [24], min_length=1)
    # "order" = "By Order": schedule strictly in upload/CSV sequence (ascending sample id),
    # borrowing "utilisation"'s fill-a-tray-before-reusing cell choice. See engine/packing.py.
    objective: Literal["fewest", "balance", "fastest", "utilisation", "order"] = "fewest"
    # 4 = one tray (Plate 1 only, up to 4 wells/day); 8 = both trays (up to 8 wells/day).
    # Caps how many wells auto-fill uses per acquisition day - see slot_scheduling.fill_slots.
    # A reuse run emerges from selecting consecutive days with cells_per_day=4 + max_uses>=2
    # (use 1 then use 2 on the same tray); a same-day parallel 8-cell run from cells_per_day=8
    # on one day. The persist layer groups those acquisitions into runs+plates. The frontend
    # surfaces this as "Plates per run" (1 tray / 2 trays).
    cells_per_day: Literal[4, 8] = 8
    start_hour: int = Field(default=DAY_START_HOUR, ge=0, le=23)
    start_minute: int = Field(default=0, ge=0, le=59)


class RecalculateRequest(BaseModel):
    """"Recalculate" next to an instrument's name in the weekly grid: re-pack every one of
    that instrument's not-yet-loaded (planned) placements from scratch with the current
    engine rules, when a schedule was built under a since-corrected rule (see
    services.auto_fill_service.recalculate_instrument)."""

    instrument_serial: str


class AutoFillResponse(BaseModel):
    placed_sample_ids: list[int]
    unplaced_sample_ids: list[int]
    # Pool IDs (Sample.pool_id) parallel to unplaced_sample_ids, so the caller can
    # tell the user WHICH samples landed back in the Backlog without a separate lookup - a bare
    # count left a user unable to find an affected sample anywhere (see auto_fill.py's
    # _to_response and useScheduleActions.ts).
    unplaced_pool_ids: list[str] = []
    skipped_cells: list[GridCellRef]
    window_flags: list[WindowFlagOut]
    # Advisory only, never blocks a placement - a distinct clock from window_flags' 108h
    # lifetime check: cells whose chained reuse start, within this batch, fell short of their
    # own prior use's real movie end + REUSE_PREP_H wash. See auto_fill_service.AutoFillResult
    # .reuse_timing_flags and docs/pacbio-sprq-nx-scheduling-reference.md's "Deliberate
    # simplifications".
    reuse_timing_flags: list[WindowFlagOut] = []
    barcode_conflicts: list[BarcodeConflictOut]
    runs: list[RunOut]
    disposed_cell_ids: list[int] = []
    # Populated only by Recalculate: samples that landed on a different calendar day than
    # before, distinct from an ordinary cell/tray reassignment - see
    # auto_fill_service.recalculate_instrument and docs/pacbio-sprq-nx-scheduling-reference.md.
    day_changed_sample_ids: list[int] = []
