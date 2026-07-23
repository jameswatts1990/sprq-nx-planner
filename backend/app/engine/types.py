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
    volume: float | None = None
    # Boolean settings stored canonically as "True"/"False" (None when unspecified).
    adaptive_loading: str | None = None
    full_resolution_base_q: str | None = None
    priority: str = ""
    ccs_kinetics: str | None = None
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
    # Real-world anchor: when this physical cell was first actually started. Lets the
    # service layer do a real-elapsed window check (not just a planned-span estimate).
    first_use_started_at: datetime | None = None
    # Cells cannot move between instruments: once a cell has a use, every later use must
    # stay on the same instrument it's already on. None means the cell has no uses yet
    # (or isn't a real persisted cell), so it isn't pinned anywhere.
    pinned_instrument_serial: str | None = None
    # A cell is physically fixed to one well for its entire life (its tray's home_well,
    # or - for a tray-less legacy cell - its last real use's well): once it has a use, it
    # can never come back to auto-fill in a different well. None means no pin yet, same
    # rule as pinned_instrument_serial above.
    pinned_well: str | None = None


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
        # populated by finalize step in pack_cells():
        self.future_uses = 0
        self.total_uses = 0
        self.cost_tier = 1
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
    `cells_per_day` argument, not by anything recorded here."""

    instrument_serial: str
    run_date: date


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
