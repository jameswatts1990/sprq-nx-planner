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

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime

from app.engine.constants import within_tray_pos

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
    """Lay out every cell on one shared hours-from-T axis. Returns {key: CellTiming}."""
    groups: dict[object, list[CellInput]] = defaultdict(list)
    for c in cells:
        groups[c.group_key].append(c)

    result: dict[object, CellTiming] = {}
    for gcells in groups.values():
        ordered = sorted(gcells, key=lambda c: (c.slot_index, str(c.key)))
        base = min((c.group_base_h for c in ordered), default=0.0)
        lane_free = [base] * SEQ_LANES
        prev_breakout: float | None = None
        for c in ordered:
            lane = c.slot_index % SEQ_LANES
            cadence_floor = c.group_base_h if prev_breakout is None else prev_breakout + STAGGER_H
            breakout = max(lane_free[lane], cadence_floor)
            movie_start = breakout + PREP_H
            movie_end = movie_start + c.run_time_h
            lane_free[lane] = movie_end
            prev_breakout = breakout
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

def _run_cell_inputs(run_batch) -> list[CellInput]:
    """Build the timing inputs for every loaded cell of a run. Cells loaded together (same plate
    ``planned_start_at``) share the sequencing lanes; a reuse plate on a later day is its own
    group off its own start."""
    from app.timeutil import ensure_aware

    cycles = [c for c in run_batch.cycles if c.cell_uses]
    if not cycles:
        return []
    earliest = min(ensure_aware(c.planned_start_at) for c in cycles)
    cells: list[CellInput] = []
    for cycle in cycles:
        base_h = (ensure_aware(cycle.planned_start_at) - earliest).total_seconds() / 3600.0
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


def run_breakout_offsets(run_batch) -> dict[int, float]:
    """Hours after the run's load time that each cell_use breaks out (starts prep). Used to
    anchor each cell's 108h window / recorded start at its own staggered breakout rather than one
    shared tray timestamp. Keyed by cell_use id; missing ids default to 0.0 at the call site."""
    timings = compute_timings(_run_cell_inputs(run_batch))
    return {key: t.breakout_h for key, t in timings.items()}


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
    Each run's cells are timed off that run's own load (earliest plate ``planned_start_at``)."""
    from app.timeutil import ensure_aware

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
        if not inputs:
            continue
        timings = compute_timings(inputs)
        load_at = min(ensure_aware(c.planned_start_at) for c in run.cycles if c.cell_uses)
        for t in timings.values():
            attr = counters.get(phase_at(t, load_at, at))
            if attr is not None:
                setattr(act, attr, getattr(act, attr) + 1)
    return act
