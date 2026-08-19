"""Plain in-memory types for the packing/scheduling engine.

No DB or FastAPI imports here on purpose - this package mirrors the
"pure logic (unit-tested)" section of the original revio-nx-planner.html
prototype and must stay independently unit-testable.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime


@dataclass
class ParsedSample:
    id: str
    barcodes: list[str]
    parent: str = ""
    sanger: list[str] = field(default_factory=list)
    target_oplc: float | None = None
    # Actual (achieved) loading concentration, distinct from the planned target_oplc.
    actual_oplc: float | None = None
    # Batch-sheet-only complex-loading dilution volumes (optional). Carried through import
    # so they can be stored on the Sample and printed on the batch sheet; unused by the
    # pure packing engine.
    cleaned_complex_volume: float | None = None
    loading_buffer_volume: float | None = None
    # Boolean settings stored canonically as "True"/"False" (None when unspecified).
    adaptive_loading: str | None = None
    full_resolution_base_q: str | None = None
    priority: str = ""
    base_kinetics: str | None = None
    # Desired movie / acquisition time (h) for this sample; None when the import didn't
    # specify one (the persist layer fills the default, 24h). Not used by the pure packing
    # engine - carried through so import can store it on the Sample.
    movie_time: int | None = None
    # Library insert / fragment size (bp) for this sample; None when the import didn't specify
    # one. Used by pack_cells to keep small-insert libraries (<= the reuse threshold) on a
    # cell's first use only - see engine/packing.py and
    # DEFAULT_INSERT_SIZE_REUSE_THRESHOLD_BP.
    insert_size_bp: int | None = None
    key: str = ""
    sample_id: int | None = None  # DB id, populated once persisted; unused by pure engine
    # When this sample entered the backlog (Sample.created_at) - drives the "oldest
    # highest-priority first" scheduling order in pack_cells(). None for samples that
    # only ever exist in-memory (e.g. the CSV-preview path in normalize.py).
    created_at: datetime | None = None


@dataclass
class PriorCellInput:
    """Analogue of the prototype's manual priorCells entry - fed by a real DB query in the app,
    or directly in tests."""

    barcodes_text: str
    uses_consumed: int
    cell_id: int | None = None  # DB id of the real Cell this represents, if any
    # barcode -> the Pool ID(s) (ParsedSample.id) that burned it on this real cell, from
    # app.services.cell_service.barcode_owners(). Lets pack_cells tell "a different sample
    # happens to share this barcode" (a real clash - blocks reuse) apart from "another copy of
    # the SAME Pool ID already used this cell" (the identical physical material - allowed,
    # see engine/packing.py's _foreign_clash). A barcode absent from this map is treated as
    # foreign to every sample - the safe default when the caller has no owner data (e.g. a
    # hand-built test, or a pre-this-feature cell) - so omitting it exactly reproduces the
    # unconditional block this guard always had.
    barcode_owners: dict[str, frozenset[str]] = field(default_factory=dict)
    # Real-world anchor: when this physical cell was first actually started. Lets the
    # service layer do a real-elapsed window check (not just a planned-span estimate).
    first_use_started_at: datetime | None = None
    # Cells cannot move between instruments: once a cell has a use, every later use must
    # stay on the same instrument it's already on. None means the cell has no uses yet
    # (or isn't a real persisted cell), so it isn't pinned anywhere.
    pinned_instrument_serial: str | None = None
    # A cell is physically fixed to one tray POSITION for life (its tray's home_well letter,
    # or - for a tray-less legacy cell - its last real use's well); the well's plate-box suffix
    # (01/02) only records where it was first loaded and does NOT bind which sample plate can
    # reuse it (see docs/pacbio-sprq-nx-scheduling-reference.md's "Plate vs cell"). None means
    # no pin yet, same rule as pinned_instrument_serial above.
    pinned_well: str | None = None
    # The physical SMRT Cell tray (CellTray.id) this cell belongs to, when known. Used by
    # fill_slots' tray-cohesion guard to keep a single sample plate backed by one tray even when
    # a cell reuses into a different plate box than its home box. None for a tray-less legacy cell.
    tray_id: int | None = None


@dataclass
class ConflictPair:
    a: str
    b: str
    shared: list[str]


class PackedCell:
    """Mutable - the packing algorithm appends uses and grows the barcode set in place,
    exactly as the prototype mutates its cell objects during packCells()."""

    def __init__(
        self,
        id: str,
        prior: bool,
        prior_barcodes: set[str],
        uses_consumed: int,
        remaining: int,
        barcodes: set[str],
        uses: list[ParsedSample],
        cell_id: int | None = None,
        pinned_instrument_serial: str | None = None,
        pinned_well: str | None = None,
        barcode_owners: dict[str, set[str]] | None = None,
        tray_id: int | None = None,
    ) -> None:
        self.id = id
        self.prior = prior
        self.prior_barcodes = prior_barcodes
        self.uses_consumed = uses_consumed
        self.remaining = remaining
        self.barcodes = barcodes
        self.uses = uses
        self.cell_id = cell_id  # DB id of the real Cell, if this represents a persisted one
        self.pinned_instrument_serial = pinned_instrument_serial
        self.pinned_well = pinned_well
        # Physical tray (CellTray.id) for a prior cell - fill_slots' cohesion guard keeps one
        # sample plate backed by a single tray. None for fresh or tray-less legacy cells.
        self.tray_id = tray_id
        # barcode -> Pool ID(s) that burned it on this cell so far (prior history plus
        # every use pack_cells has appended this batch) - see PriorCellInput.barcode_owners
        # and engine/packing.py's _foreign_clash.
        self.barcode_owners: dict[str, set[str]] = {k: set(v) for k, v in (barcode_owners or {}).items()}
        # populated by finalize step in pack_cells():
        self.future_uses = 0
        self.total_uses = 0
        self.cost_tier = 1
        # True once this cell has been given every use its OWN batch-specific ceiling
        # allows (the max_uses dial, further narrowed by available_days) - as opposed to
        # stopping short of that ceiling because pack_cells simply ran out of compatible
        # samples to give it. Distinct from "physically exhausted" (total_uses reaching
        # the hard CELL_MAX_USES=3): a dial set below 3 means a cell can be fully done
        # with this batch's plan while still short of its real lifetime capacity. Only
        # the batch-ceiling case means fill_slots may safely hand this cell's well to a
        # different cell later in the SAME batch (see slot_scheduling.py's
        # _well_is_vacated) - a cell that merely ran out of compatible samples must keep
        # its well reserved indefinitely, since it may still be reused in a later,
        # separate Auto Schedule call and that reuse must land back in this exact well.
        self.batch_capacity_reached = False
        # populated by schedule_cells():
        self.window_h: float = 0.0
        self.machine: str | None = None
        self.stage_no: int | None = None


@dataclass
class PackResult:
    cells: list[PackedCell]
    all_cells: list[PackedCell]
    unplaced: list[ParsedSample]
    conflict_pairs: list[ConflictPair]


@dataclass
class WindowFlag:
    cell: str
    span: float


# --- slot-scoped scheduling (interactive grid: auto-fill of empty (instrument, day) cells) ---


@dataclass(frozen=True)
class SlotInput:
    """A currently-empty grid cell offered to the auto-filler: an (instrument, day) run
    with all wells free by construction (occupied cells are never passed in). How many
    of its 8 wells `fill_slots` actually offers is capped by that call's own
    `cells_per_day` argument, not by anything recorded here.

    ``reuse_only`` marks a *continuation* slot: the calendar day after a load slot, on which
    a cell already loaded on the preceding day may take its next (reuse) use as a bundled
    Plate 2 - NOT a day on which a fresh first use may load. It exists so a single load day
    can drive a tray one use deeper (Use N on the load day, Use N+1 the next day, incl. a
    weekend), rather than the reuse being stranded for want of a second load slot. The
    caller (auto_fill_service) keeps LOAD days weekday-only and never creates a run on a
    reuse_only day - the continuation is always bundled into its origin run's Plate 2."""

    instrument_serial: str
    run_date: date
    reuse_only: bool = False


@dataclass
class SlotAssignment:
    cell: PackedCell
    sample: ParsedSample
    well: str
    instrument_serial: str
    run_date: date


@dataclass
class SlotFillResult:
    assignments: list[SlotAssignment]
    filled_slots: list[SlotInput]
    unplaced: list[ParsedSample]
    window_flags: list[WindowFlag]
