"""Canonical per-cell instrument timing — the single Python source of truth mirrored by the
frontend gantt (frontend/src/utils/stageTimings.ts). Given a run's loaded cells it derives, for
each cell, when it breaks out (prep start), sequences (movie), and runs PPA, from the physical
limits of the instrument:

  - **Breakout drives everything.** A cell's 108h reuse window anchors at its breakout, and its
    movie starts ``PREP_H`` (4h) after breakout.
  - **Adaptive loading: cells break out ``STAGGER_H`` (2h) apart** within a load group.
  - **``SEQ_LANES`` (4) sequencing lanes.** A cell holds one of the instrument's 4 physical
    positions from breakout until its movie ends, so a same-session second tray cannot break out
    until the first tray's movies free the lanes (~28h after load = 4h prep + 24h movie).
  - **``PPA_LANES`` (2) PPA lanes.** At most two cells are in PPA at once; a cell whose movie ends
    while both lanes are busy waits (PPA-pending).

See docs/pacbio-sprq-nx-scheduling-reference.md, "Per-cell breakout, PPA capacity, and instrument
state". These are estimates derived from PacBio's adaptive-loading timing slide; keep them in
lockstep with the frontend constants of the same names.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from app.engine.constants import within_tray_pos
from app.timeutil import ensure_aware

PREP_H = 4.0
STAGGER_H = 2.0
PPA_H = 6.0
PPA_LANES = 2
SEQ_LANES = 4


@dataclass
class CellInput:
    """One loaded cell for the timing model, positioned relative to the timeline's load time T."""

    key: object
    slot_index: int  # 0-7: Plate 1 -> 0-3, Plate 2 -> 4-7 (lane = slot_index % SEQ_LANES)
    run_time_h: float
    group_base_h: float  # hours from T to this cell's load group's base (its plate's start)
    group_key: object  # cells sharing this key were loaded together and share the 4 seq lanes


@dataclass
class CellTiming:
    key: object
    breakout_h: float  # start of prep = the 108h window anchor
    movie_start_h: float
    movie_end_h: float
    ppa_start_h: float = field(default=0.0)
    ppa_end_h: float = field(default=0.0)


def compute_timings(cells: list[CellInput]) -> dict[object, CellTiming]:
    """Lay out every input cell on one shared hours-from-T axis, returning {key: CellTiming}.

    Sequencing is a **4-server (SEQ_LANES) instrument resource shared across EVERY cell in the
    input**: a cell holds one server from its breakout until its movie ends, and takes the
    earliest-free server. Feed one run's cells (``_run_cell_inputs``) and you get that run in
    isolation; feed an instrument's whole resident set (``instrument_timeline``) and cells from
    *different runs* contend for the same 4 servers — that's how a run loaded while the machine
    is busy has its cells pushed to when a server frees. The 2h adaptive-loading **prep stagger**
    is per load group (``group_key`` = one loading session), so separate loads don't chain their
    prep off each other. PPA is the global 2-server pass (``_schedule_ppa``).

    Reproduces the pre-cross-run within-run result as a special case (a single 8-cell parallel
    run still yields breakouts [0,2,4,6] then [28,30,32,34]); a real reuse plate is unchanged
    because it already loads after Plate 1's movie frees the servers (see reuse_plate_window)."""
    ordered = sorted(cells, key=lambda c: (c.group_base_h, c.slot_index, str(c.key)))
    result: dict[object, CellTiming] = {}
    if not ordered:
        return result
    base0 = min(c.group_base_h for c in ordered)
    servers = [base0] * SEQ_LANES  # earliest-free time of each of the 4 sequencing servers
    prev_breakout: dict[object, float] = {}  # last breakout per load group -> the 2h prep-stagger floor
    for c in ordered:
        stagger_floor = c.group_base_h if c.group_key not in prev_breakout else prev_breakout[c.group_key] + STAGGER_H
        i = min(range(SEQ_LANES), key=lambda j: servers[j])  # earliest-free sequencing server
        breakout = max(stagger_floor, servers[i])
        movie_start = breakout + PREP_H
        movie_end = movie_start + c.run_time_h
        servers[i] = movie_end
        prev_breakout[c.group_key] = breakout
        result[c.key] = CellTiming(c.key, breakout, movie_start, movie_end)

    _schedule_ppa(result.values())
    return result


def _schedule_ppa(timings) -> None:
    """Apply the 'only PPA_LANES cells in PPA at once' limit across all cells (greedy earliest-
    ready 2-server assignment); mutates each timing's ppa_start_h / ppa_end_h."""
    order = sorted(timings, key=lambda t: (t.movie_end_h, t.breakout_h))
    lane_free = [float("-inf")] * PPA_LANES
    for t in order:
        i = min(range(PPA_LANES), key=lambda j: lane_free[j])
        start = max(t.movie_end_h, lane_free[i])
        lane_free[i] = start + PPA_H
        t.ppa_start_h = start
        t.ppa_end_h = start + PPA_H


# --- adapters over the ORM ---------------------------------------------------------------------

def _plate_anchor(cycle) -> datetime:
    """This plate's effective load anchor on the timeline: its real confirm-load time
    (``actual_start_at``, set once the plate is running) when known, else its planned start.
    "Loading time = the time entered at Confirm loaded" (docs/pacbio-sprq-nx-scheduling-
    reference.md, "Per-cell breakout..."), so once a run is loaded its live "what's running"
    state and its gantt key off the *real* load; a still-planned run keys off the plan. Mirrored
    by the frontend gantt (frontend/src/utils/stageTimings.ts ``plateAnchorMs``)."""
    return ensure_aware(cycle.actual_start_at or cycle.planned_start_at)


def _run_cell_inputs(run_batch) -> list[CellInput]:
    """Build the timing inputs for every loaded cell of a run. Cells loaded together (same plate
    ``planned_start_at``) share the sequencing lanes; a reuse plate on a later day is its own
    group off its own start. Offsets are measured from each plate's *effective* anchor
    (``_plate_anchor``: actual load once running, else planned), so a run confirmed-loaded at a
    different time than planned lays out from when it truly started."""
    cycles = [c for c in run_batch.cycles if c.cell_uses]
    if not cycles:
        return []
    earliest = min(_plate_anchor(c) for c in cycles)
    cells: list[CellInput] = []
    for cycle in cycles:
        base_h = (_plate_anchor(cycle) - earliest).total_seconds() / 3600.0
        for cu in cycle.cell_uses:
            pos = within_tray_pos(cu.cell.home_well or cu.well or "")
            slot = (cycle.plate_index - 1) * SEQ_LANES + pos
            cells.append(
                CellInput(
                    key=cu.id,
                    slot_index=slot,
                    run_time_h=float(cu.run_time_hours),
                    group_base_h=base_h,
                    group_key=cycle.planned_start_at,
                )
            )
    return cells


def instrument_timeline(run_batches) -> dict[int, datetime]:
    """Cross-run sequencing schedule for one instrument: every cell across ``run_batches`` contends
    for the same 4 sequencing servers (see ``compute_timings``). Returns each run's **effective
    start** — the absolute time its earliest cell actually breaks out once the machine's *other*
    resident runs are accounted for — keyed by run id. A run whose cells find free servers starts
    at its own load; one loaded while the instrument is busy is pushed to when a server frees.

    Anchored on the earliest effective plate anchor (``_plate_anchor``) across the runs, so a
    confirmed-loaded run is timed off its real load and a still-planned one off its plan. The
    caller decides which runs are "resident" together (e.g. those overlapping a new run's load)."""
    runs = [r for r in run_batches if any(c.cell_uses for c in r.cycles)]
    if not runs:
        return {}
    t0 = min(_plate_anchor(c) for r in runs for c in r.cycles if c.cell_uses)
    cells: list[CellInput] = []
    run_of: dict[object, int] = {}
    for r in runs:
        for cyc in r.cycles:
            if not cyc.cell_uses:
                continue
            base_h = (_plate_anchor(cyc) - t0).total_seconds() / 3600.0
            for cu in cyc.cell_uses:
                pos = within_tray_pos(cu.cell.home_well or cu.well or "")
                slot = (cyc.plate_index - 1) * SEQ_LANES + pos
                cells.append(
                    CellInput(
                        key=cu.id,
                        slot_index=slot,
                        run_time_h=float(cu.run_time_hours),
                        group_base_h=base_h,
                        # (run, plate-start) so different runs are separate prep-stagger groups but
                        # still share the 4 sequencing servers across the whole instrument.
                        group_key=(r.id, cyc.planned_start_at),
                    )
                )
                run_of[cu.id] = r.id
    timings = compute_timings(cells)
    eff_h: dict[int, float] = {}
    for key, t in timings.items():
        rid = run_of[key]
        eff_h[rid] = min(eff_h[rid], t.breakout_h) if rid in eff_h else t.breakout_h
    return {rid: t0 + timedelta(hours=h) for rid, h in eff_h.items()}


def run_breakout_offsets(run_batch) -> dict[int, float]:
    """Hours after the run's load time that each cell_use breaks out (starts prep). Used to
    anchor each cell's 108h window / recorded start at its own staggered breakout rather than one
    shared tray timestamp. Keyed by cell_use id; missing ids default to 0.0 at the call site."""
    timings = compute_timings(_run_cell_inputs(run_batch))
    return {key: t.breakout_h for key, t in timings.items()}


def run_load_at(run_batch) -> datetime | None:
    """The run's effective load time = the earliest plate anchor (real confirm-load once running,
    else planned - see ``_plate_anchor``). None when nothing is loaded."""
    cycles = [c for c in run_batch.cycles if c.cell_uses]
    if not cycles:
        return None
    return min(_plate_anchor(c) for c in cycles)


def run_acquisition_end(run_batch) -> datetime | None:
    """The absolute time the run's *last* cell finishes PPA. The instrument is physically busy
    with this run - some cell prepping, sequencing, or in PPA - from ``run_load_at`` until here,
    so this is the run's "what's running now" window end. Derived from the same per-cell timing
    model as the gantt, so the two agree cell-for-cell. None when nothing is loaded.

    Distinct from ``instrument_lock.run_lock_until``: that is the much shorter *loading*-lock that
    gates when a brand-new run may be loaded (a single tray frees the loading bay after
    LOCK_BUFFER_HOURS even while its cells keep sequencing for ~30h). Using the loading-lock as
    the "is it still running" test is exactly what made a mid-sequencing run read as idle."""
    load_at = run_load_at(run_batch)
    if load_at is None:
        return None
    timings = compute_timings(_run_cell_inputs(run_batch))
    return load_at + timedelta(hours=max((t.ppa_end_h for t in timings.values()), default=0.0))


def run_load_lock_end(run_batch) -> datetime | None:
    """When the instrument frees to **load a new run** after this one = the instant this run's
    LAST cell finishes prep (breakout + PREP_H), i.e. the end of the last purple "Prep" bar in the
    adaptive-loading slide (docs/pacbio-sprq-nx-scheduling-reference.md, capacity fact #3's
    "awaiting-prep ⇒ locked"). Dynamic in the cell count via the same per-cell model as the gantt:
    one tray's four cells finish prep at load+4/6/8/10h (4h prep, 2h-staggered); a second tray's
    cells are *prep-pending* until the first frees the 4 sequencing lanes (~28h), finishing prep at
    ~32-38h. None when nothing is loaded.

    Distinct from ``run_acquisition_end`` (last PPA end, the full "still on the instrument" window):
    the loading bay frees when every cell has broken out, long before the movies + PPA finish. This
    is the single source of truth for ``instrument_lock.run_lock_until``."""
    load_at = run_load_at(run_batch)
    if load_at is None:
        return None
    timings = compute_timings(_run_cell_inputs(run_batch))
    return load_at + timedelta(hours=max((t.movie_start_h for t in timings.values()), default=0.0))


def run_is_acquiring(run_batch, at: datetime) -> bool:
    """True when ``at`` falls in this run's ``[load, last-PPA-end)`` acquisition window - i.e. the
    run physically has cells on the instrument doing something at ``at``. The single source of
    truth the Instruments page, its live gantts, and RunOut.is_locked all share."""
    load_at = run_load_at(run_batch)
    end = run_acquisition_end(run_batch)
    return load_at is not None and end is not None and load_at <= at < end


# --- live instrument state ---------------------------------------------------------------------

# The phases a cell moves through, in order. "done" is terminal and not counted as activity.
PHASE_AWAITING_PREP = "awaiting_prep"  # loaded but idle - the instrument is busy (prep-pending)
PHASE_PREPPING = "prepping"            # breaking out (prep)
PHASE_SEQUENCING = "sequencing"        # movie / acquiring
PHASE_PPA_PENDING = "ppa_pending"      # movie done, waiting for a PPA lane
PHASE_IN_PPA = "in_ppa"                # post-primary analysis
PHASE_DONE = "done"


@dataclass
class InstrumentActivity:
    """How many of an instrument's resident cells are in each phase right now. Encodes the three
    capacity facts the app cares about: the instrument is "locked" for a fresh load while any cell
    is awaiting/undergoing prep; ``sequencing`` is capped at SEQ_LANES (4) and ``in_ppa`` at
    PPA_LANES (2)."""

    awaiting_prep: int = 0
    prepping: int = 0
    sequencing: int = 0
    ppa_pending: int = 0
    in_ppa: int = 0

    @property
    def prep_locked(self) -> bool:
        """True while any cell is awaiting prep or prepping - the instrument can't take a fresh load."""
        return self.awaiting_prep + self.prepping > 0

    @property
    def active(self) -> bool:
        return self.awaiting_prep + self.prepping + self.sequencing + self.ppa_pending + self.in_ppa > 0


def phase_at(timing: CellTiming, load_at: datetime, at: datetime) -> str:
    """Which phase a cell is in at ``at``, given the timeline's load time ``load_at``."""
    h = (at - load_at).total_seconds() / 3600.0
    if h < timing.breakout_h:
        return PHASE_AWAITING_PREP
    if h < timing.movie_start_h:
        return PHASE_PREPPING
    if h < timing.movie_end_h:
        return PHASE_SEQUENCING
    if h < timing.ppa_start_h:
        return PHASE_PPA_PENDING
    if h < timing.ppa_end_h:
        return PHASE_IN_PPA
    return PHASE_DONE


def instrument_activity(run_batches, at: datetime) -> InstrumentActivity:
    """Aggregate the live phase of every resident cell across the given runs at time ``at``.
    Each run's cells are timed off that run's own effective load (``run_load_at``: real
    confirm-load once running, else planned)."""
    act = InstrumentActivity()
    counters = {
        PHASE_AWAITING_PREP: "awaiting_prep",
        PHASE_PREPPING: "prepping",
        PHASE_SEQUENCING: "sequencing",
        PHASE_PPA_PENDING: "ppa_pending",
        PHASE_IN_PPA: "in_ppa",
    }
    for run in run_batches:
        inputs = _run_cell_inputs(run)
        load_at = run_load_at(run)
        if not inputs or load_at is None:
            continue
        timings = compute_timings(inputs)
        for t in timings.values():
            attr = counters.get(phase_at(t, load_at, at))
            if attr is not None:
                setattr(act, attr, getattr(act, attr) + 1)
    return act
