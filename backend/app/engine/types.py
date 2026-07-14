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
    oplc: float | None = None
    target_oplc: float | None = None
    volume: float | None = None
    container_id: str = ""
    adaptive_loading: str = ""
    full_resolution_base_q: str = ""
    priority: str = ""
    ccs_kinetics: str = ""
    key: str = ""
    sample_id: int | None = None  # DB id, populated once persisted; unused by pure engine


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
class Stage:
    cell: PackedCell
    sample: ParsedSample
    well: str
    stage_no: int


@dataclass
class Cycle:
    machine_idx: int
    machine: str
    batch_idx: int
    use_idx: int
    start_h: float
    end_h: float
    stages: list[Stage]
    day_idx: int = 0
    time_of_day: float = 0.0
    end_day_idx: int = 0


@dataclass
class WindowFlag:
    cell: str
    span: float


@dataclass
class ScheduleResult:
    cycles: list[Cycle]
    window_flags: list[WindowFlag]
    max_day: int
    duration_days: int


@dataclass
class KPIResult:
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


# --- slot-scoped scheduling (interactive grid: auto-fill of empty (instrument, day) cells) ---


@dataclass(frozen=True)
class SlotInput:
    """A currently-empty grid cell offered to the auto-filler: an (instrument, day) run
    with all 8 wells free by construction (occupied cells are never passed in)."""

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
