"""Auto-fill: the "auto schedule" assist. Given a user-selected set of empty grid cells,
packs the current backlog (reusing the prior-cell pool) and places as many samples as
fit onto those cells - re-running the exact same engine path (pack_cells + fill_slots)
server-side rather than trusting any client plan."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from app.engine.constants import (
    CELL_LIFETIME_H,
    CELL_MAX_USES,
    CELLS_PER_TRAY,
    DAY_START_HOUR,
    DEFAULT_MOVIE_HOURS,
    WELLS,
    within_tray_pos,
)
from app.engine.packing import pack_cells
from app.engine.slot_scheduling import fill_slots
from app.engine.types import ConflictPair, SlotInput
from app.models.audit import AuditLog
from app.models.cell import Cell
from app.models.instrument import Instrument
from app.models.sample import Sample
from app.models.schedule import CellUse, CellUseBarcode, Cycle, RunBatch
from app.services import instrument_lock
from app.services.cell_service import mark_cell_discarded, open_new_tray, recompute_status
from app.services.cell_timing import coarse_movie_end
from app.services.engine_bridge import load_backlog_samples, load_prior_cells, to_parsed_samples
from app.services.settings_service import get_insert_size_reuse_threshold, get_movie_rules
from app.services.placement_service import (
    PlacementError,
    get_or_create_run,
    planned_window,
    recompute_cycle_timing,
    remove_samples,
)
from app.timeutil import ensure_aware, utcnow


@dataclass(frozen=True)
class _CellRef:
    """Local (instrument, day) ref for recalculate_instrument's internal use - the same
    duck-typed shape `auto_fill`'s `cells` param already expects (schemas.run.GridCellRef at
    the API layer), kept here instead of importing the schema into a service module."""

    instrument_serial: str
    load_date: date


@dataclass
class AutoFillResult:
    placed_sample_ids: list[int] = field(default_factory=list)
    unplaced_sample_ids: list[int] = field(default_factory=list)
    skipped_cells: list[tuple[str, date]] = field(default_factory=list)
    window_flags: list[tuple[str, float]] = field(default_factory=list)
    # Advisory only (never blocks a placement): (cell_code, worst-shortfall-hours) for a cell
    # whose chained reuse start, within this batch, fell short of its own prior use's real movie
    # end - see the assign_start loop below. A distinct clock from window_flags' 108h lifetime
    # check (see docs/pacbio-sprq-nx-scheduling-reference.md's "Deliberate simplifications").
    reuse_timing_flags: list[tuple[str, float]] = field(default_factory=list)
    barcode_conflicts: list[ConflictPair] = field(default_factory=list)
    run_ids: list[int] = field(default_factory=list)  # RunBatch (run) ids the batch created/touched
    disposed_cell_ids: list[int] = field(default_factory=list)  # cells auto-disposed after the run (dial cap / unused sibling)
    # sample_id -> the day it actually ACQUIRES (sequences) this batch - not the run's own
    # load_date, which can differ for a bundled Plate 2 reuse (see the persist loop below).
    # Populated for every real placement (both auto_fill and recalculate_instrument);
    # recalculate_instrument uses it to diff against each sample's PRE-recalculate acquire day
    # and derive day_changed_sample_ids below - internal plumbing, not returned over the API
    # (see AutoFillResponse).
    sample_acquire_dates: dict[int, date] = field(default_factory=dict)
    # Populated only by recalculate_instrument: samples that landed on a DIFFERENT calendar day
    # than they were on before the recalculate (as opposed to merely a different cell/tray on the
    # same day). Always empty for an ordinary auto_fill() call, since a backlog sample has no
    # "before" day to diff against. Surfaced distinctly because a day change has real lab-
    # operational impact (collaborator commitments, staffing) that a cell/tray reassignment
    # doesn't - see docs/pacbio-sprq-nx-scheduling-reference.md's "Recalculate" section.
    day_changed_sample_ids: list[int] = field(default_factory=list)


def _dispose_tray_if_fully_used(db: Session, tray_id: int, max_uses: int, now: datetime) -> list[int]:
    """Bin every cell of `tray_id` (mark_cell_discarded, bare - keeps this batch's own
    just-scheduled uses intact) once EVERY cell in it has reached `max_uses` active uses -
    the "Max uses per cell" dial enforces a per-cell TOTAL-use cap, but a SMRT-cell tray of
    4 is one physical object (see docs/pacbio-sprq-nx-scheduling-reference.md's "Tray-of-4"
    invariant), so disposal is tray-scoped: all-or-nothing, never per cell.

    Callable from two places: inline, the moment a same-batch reload needs this exact box
    back (see the persist loop's collision-retirement branch below - open_new_tray()'s
    DB-level guard only ever sees a cell as available once its status has actually left
    "open", and recompute_status() alone never does that for a dial below the physical
    3-use cap), and again in the end-of-batch sweep further down, for any tray that
    reached the dial but was never fought over mid-batch. Idempotent - a tray already
    disposed, not yet fully used, or under manual QC hold (retired/stopped) is left
    untouched - so calling it twice on the same tray_id is always safe. Returns the ids of
    cells this call actually disposed (empty if none)."""
    tray_cells = db.scalars(select(Cell).where(Cell.tray_id == tray_id)).all()
    for cell in tray_cells:
        db.refresh(cell, attribute_names=["cell_uses"])
    # A stopped/retired cell means the tray needs manual attention - never auto-bin it.
    if any(cell.status in ("retired", "stopped") for cell in tray_cells):
        return []

    def _active_uses(cell: Cell) -> int:
        return len([cu for cu in cell.cell_uses if cu.status != "cancelled"])

    # Not fully spent yet (some cell hasn't reached the dial) - leave the whole tray open.
    if not all(_active_uses(cell) >= max_uses for cell in tray_cells):
        return []
    # Every cell reached the dial: bin the tray as one unit. Cells already terminal by
    # natural exhaustion (dial == 3) carry no leftover capacity and need no flag or count;
    # only cells still "open" (used to the dial with physical capacity to spare, dial < 3)
    # are the ones actually being disposed early, so those are what we mark and report.
    disposed: list[int] = []
    for cell in tray_cells:
        if cell.status != "open" or cell.discarded_at is not None:
            continue
        mark_cell_discarded(cell, f"Auto schedule: tray fully used to max {max_uses}", now)
        disposed.append(cell.id)
    return disposed


def auto_fill(
    db: Session,
    *,
    cells,
    max_uses: int,
    movie_times: list[int],
    objective: str,
    cells_per_day: int = len(WELLS),
    start_hour: int = DAY_START_HOUR,
    start_minute: int = 0,
    actor: str | None = None,
    sample_ids: list[int] | None = None,
):
    # Movie times (12/24/30) the user ticked in the Autoschedule panel - only backlog samples
    # of these lengths are scheduled this batch. Each placed well then runs for its OWN
    # sample's movie time, and 12h/30h samples are confined to cell 1/cell 4 respectively
    # (see engine/packing.cell_allowed_positions and engine/slot_scheduling.fill_slots).
    movie_set = set(movie_times)
    # A single conservative length only for the new-run lock gate below (which just needs "does
    # a prior lock span the whole load day"): the longest ticked movie can't under-reserve.
    probe_hours = max(movie_times) if movie_times else DEFAULT_MOVIE_HOURS

    def _movie(sample) -> int:
        return sample.movie_time or DEFAULT_MOVIE_HOURS

    # --- validation ---
    for c in cells:
        if c.load_date.weekday() >= 5:
            raise PlacementError(400, f"{c.load_date.isoformat()} is a weekend - runs are weekdays only.")

    serials = {c.instrument_serial for c in cells}
    instruments = {
        i.serial_number: i
        for i in db.scalars(select(Instrument).where(Instrument.serial_number.in_(serials))).all()
    }
    for c in cells:
        if c.instrument_serial not in instruments:
            raise PlacementError(400, f"Unknown instrument serial '{c.instrument_serial}'.")

    # dedupe requested cells, then re-check each is still empty (and unlocked) at execution time
    requested: list[tuple[str, date]] = []
    seen: set[tuple[str, date]] = set()
    for c in cells:
        key = (c.instrument_serial, c.load_date)
        if key not in seen:
            seen.add(key)
            requested.append(key)

    empty_slots: list[SlotInput] = []
    skipped: list[tuple[str, date]] = []
    for serial, run_date in requested:
        inst = instruments[serial]
        # A maintenance-down instrument refuses new runs on/after its down date - skip the
        # slot (same "skip, don't hard-fail the batch" UX as an already-locked day below)
        # rather than letting get_or_create_run raise mid-loop. The grid already greys these
        # days so the user shouldn't be able to select them, but auto-fill re-validates
        # server-side rather than trusting the client selection.
        if inst.down_from is not None and run_date >= inst.down_from:
            skipped.append((serial, run_date))
            continue
        # Checked via CellUse, not just RunBatch's existence: a RunBatch/Cycle can survive
        # with zero stages (remove_sample's concurrent bulk-delete race, or the admin
        # table-clear tool - see get_or_create_run's docstring), and the grid already
        # treats that as an open, selectable cell (groupCyclesByInstrumentAndDay.isCellOpen).
        # Skipping on RunBatch existence alone silently dropped exactly the cells the UI
        # just told the user were empty. "cancelled" rows are excluded too, for the same
        # reason: a Stop-Cell-cascaded cancelled use is a permanent marker occupying one
        # well, not a real placement, and isCellOpen already treats a cancelled-only cycle
        # as open on the frontend - this must agree or Auto Schedule silently skips a cell
        # the grid just let the user select.
        occupied = db.scalar(
            select(CellUse.id)
            .join(CellUse.cycle)
            .join(Cycle.run_batch)
            .where(
                RunBatch.instrument_id == inst.id,
                RunBatch.load_date == run_date,
                CellUse.status != "cancelled",
            )
        )
        if occupied is not None:
            skipped.append((serial, run_date))
            continue
        proposed_start, _proposed_end = planned_window(run_date, probe_hours, start_hour, start_minute)
        if instrument_lock.resolve_new_run_start(db, inst.id, run_date, proposed_start) is None:
            # Same rule as place_sample: only a lock spanning the *whole* load day blocks it
            # (a lock clearing on the day still leaves it loadable - get_or_create_run starts
            # the run when the instrument frees). Skip this slot rather than hard-failing the
            # whole batch, matching the existing "already occupied" skip UX.
            skipped.append((serial, run_date))
        else:
            empty_slots.append(SlotInput(instrument_serial=serial, run_date=run_date))

    # --- engine ---
    # Only the ticked movie times are scheduled; the rest stay in the backlog (a sample with no
    # movie time reads as the 24h default). Filtered-out samples are NOT reported as "unplaced"
    # - they were never offered to this batch - since unplaced is derived from `samples` below.
    # `sample_ids`, when given, additionally restricts the pool to exactly those backlog
    # samples (used by recalculate_instrument, which must only ever re-pack the specific
    # samples it just unscheduled from one instrument - never invite the wider backlog to
    # compete for the freed slots).
    samples = [
        s for s in load_backlog_samples(db, sample_ids) if (s.movie_time_hours or DEFAULT_MOVIE_HOURS) in movie_set
    ]
    parsed = to_parsed_samples(samples)
    prior_cells, cells_by_id = load_prior_cells(db, [])
    # Cells cannot move between instruments: a prior cell pinned to an instrument that
    # isn't one of this call's actual empty slots can never be placed by fill_slots below
    # (see its pin filter) - exclude it from packing entirely, rather than letting it
    # "claim" a disjoint sample via barcode-compatibility only to strand that sample as
    # unplaced when a fresh cell on an offered instrument would have fit it instead.
    offered_serials = {s.instrument_serial for s in empty_slots}
    prior_cells = [
        pc for pc in prior_cells if pc.pinned_instrument_serial is None or pc.pinned_instrument_serial in offered_serials
    ]
    # A cell can only be reused once per calendar day (see fill_slots), so a reuse depth
    # deeper than the number of distinct days actually on offer can never be placed -
    # capping it here spreads samples across fresh cells instead of packing depth that
    # would just come back as unplaced.
    available_days = len({s.run_date for s in empty_slots})
    # Lab-configurable scheduling rules read once here and passed into the pure engine so it
    # stays DB-free (same pattern for both the small-insert threshold and the movie-time rules).
    movie_rules = get_movie_rules(db)
    pack = pack_cells(
        parsed,
        max_uses=max_uses,
        objective=objective,
        prior_cells=prior_cells,
        available_days=available_days,
        cells_per_day=cells_per_day,
        # Small-insert (<5 kb) libraries are kept on a cell's first use only - threshold is
        # admin-configurable (settings_service), read here so the pure engine stays DB-free.
        insert_size_reuse_threshold=get_insert_size_reuse_threshold(db),
        # Movie-time cell-position rules + default length (Settings > Movie scheduling).
        movie_rules=movie_rules,
    )
    fill = fill_slots(pack.cells, empty_slots, cells_per_day=cells_per_day, movie_rules=movie_rules)

    # PackedCell.id -> DB Cell (prior cells resolve to real rows; fresh cells created on first use)
    ref_to_cell: dict[str, Cell] = {pc.id: cells_by_id[pc.cell_id] for pc in pack.cells if pc.prior}

    # --- persist ---
    # Per-cell chronological use order within this batch - also drives the intra-run reuse
    # bundling below.
    uses_by_cell_ref: dict[str, list] = defaultdict(list)
    for a in fill.assignments:
        uses_by_cell_ref[a.cell.id].append(a)
    for uses in uses_by_cell_ref.values():
        uses.sort(key=lambda x: x.run_date)
    use_index_by_assignment: dict[int, int] = {
        id(u): i for uses in uses_by_cell_ref.values() for i, u in enumerate(uses)
    }
    first_use_date_by_cell: dict[str, date] = {
        cell_ref: uses[0].run_date for cell_ref, uses in uses_by_cell_ref.items()
    }

    # One RunBatch per (instrument, load_date), one or two Cycles ("plates") - matching the
    # real workflow: the OPERATOR loads a run (grid's day axis), the CELL STUB shows what the
    # machine actually does with it (Use 1/2/3), and those two things can legitimately
    # diverge. A cell's own SECOND use is bundled into the SAME run as its first, as Plate 2
    # (acquire_date > load_date - the machine doesn't get to it until the shared 4-lane
    # sequencer frees up, by which point Plate 1's own cells have finished their first
    # acquisition) - mirroring the intra-run reuse Plate 2 manual placement already uses
    # (placement_service._plate_target/_cell_used_in_run). This ONLY applies in 2-plate mode
    # (cells_per_day == len(WELLS)): 1-plate mode never opens a Plate 2 at all, so it's
    # unaffected (and can't regress the "2 plates on Monday contradicts 1 plate per run" bug
    # this shape used to cause - see docs/pacbio-sprq-nx-scheduling-reference.md). A cell's
    # THIRD use (if reached) always starts its own separate run - a run holds at most 2
    # plates - as does any cell whose own first use already landed in Plate 2's box (its
    # origin run has no Plate 1 slot of its own to pair with), or a day whose Plate 2 is
    # already the home of a genuinely different, fresh second tray (loaded in Plate 2's own
    # wells, A02-D02, the SAME day - two distinct physical trays touched down together).
    # `plate2_kind` tracks, per origin (instrument, load_date), which of those two mutually
    # exclusive things Plate 2 is being used for so a later cell can't collide with an
    # earlier one's choice; assignments are walked in chronological (run_date) order so a
    # day's own fresh-tray claim (if any) is always resolved before a later reuse tries to
    # bundle into it.
    def _tray_ref(cell_ref: str, well: str, instrument_serial: str) -> tuple[str, object]:
        """A comparable "same physical tray" identity for `cell_ref`, resolvable at this point
        in the persist loop - i.e. before a fresh cell's real Cell/tray_id exists. Used to stop
        a Plate 2 bundle claiming cells from more than one physical tray (a Plate is one
        carousel box, which can only ever hold one tray - see placement_service._established_
        tray_id): plate2_kind alone only tracked "fresh" vs "reuse" per (instrument, day), with
        no tray identity, so a SECOND, unrelated tray's own reuse could satisfy `== "reuse"`
        and get bundled into a Plate 2 a different tray already established there, purely
        because both cells' own first-batch use happened to land on the same day.
        - A PRIOR cell already resolved in ref_to_cell uses its REAL Cell.tray_id when it has
          one - siblings of one physical tray always compare equal, required for the existing,
          correct intra-tray Plate1+Plate2 bundling to keep working.
        - A cell with no entry in ref_to_cell is genuinely fresh: stand in with (instrument,
          box_start) - open_new_tray's own box-collision guard (and this function's own
          opened_boxes/well_claimant cache below) already guarantees a box resolves to exactly
          one real tray for this whole batch, so this is exact, not a guess.
        - A legacy prior cell with no tray_id: a per-cell-ref sentinel matching nothing else -
          conservative (can still bundle its own reuse, can never be mistaken for a different
          cell)."""
        db_cell = ref_to_cell.get(cell_ref)
        if db_cell is not None and db_cell.tray_id is not None:
            return ("tray", db_cell.tray_id)
        if db_cell is None:
            box_start = (WELLS.index(well) // CELLS_PER_TRAY) * CELLS_PER_TRAY
            return ("box", (instrument_serial, box_start))
        return ("cell", cell_ref)

    load_date_of: dict[int, date] = {}
    plate_index_of: dict[int, int] = {}
    acquire_date_of: dict[int, date] = {}
    plate2_kind: dict[tuple[str, date], str] = {}  # (instrument_serial, origin load_date) -> "fresh" | "reuse"
    plate2_tray_ref: dict[tuple[str, date], tuple[str, object]] = {}  # same key -> _tray_ref already bundled there
    for a in sorted(fill.assignments, key=lambda a: (a.instrument_serial, a.run_date)):
        cell_ref = a.cell.id
        origin_date = first_use_date_by_cell[cell_ref]
        use_idx = use_index_by_assignment[id(a)]
        in_plate1_box = a.well in WELLS[:CELLS_PER_TRAY]
        origin_key = (a.instrument_serial, origin_date)

        if use_idx == 0:
            load_date_of[id(a)] = a.run_date
            acquire_date_of[id(a)] = a.run_date
            if in_plate1_box:
                plate_index_of[id(a)] = 1
            else:
                plate_index_of[id(a)] = 2
                plate2_kind[origin_key] = "fresh"
        elif (
            use_idx == 1
            and cells_per_day == len(WELLS)
            and in_plate1_box
            and plate2_kind.get(origin_key, "reuse") == "reuse"
            and (
                origin_key not in plate2_tray_ref
                or plate2_tray_ref[origin_key] == _tray_ref(cell_ref, a.well, a.instrument_serial)
            )
        ):
            load_date_of[id(a)] = origin_date
            plate_index_of[id(a)] = 2
            acquire_date_of[id(a)] = a.run_date
            plate2_kind[origin_key] = "reuse"
            plate2_tray_ref[origin_key] = _tray_ref(cell_ref, a.well, a.instrument_serial)
        else:
            load_date_of[id(a)] = a.run_date
            acquire_date_of[id(a)] = a.run_date
            plate_index_of[id(a)] = 1 if in_plate1_box else 2

    # Per-well planned start. A cell's first use in this batch starts at the run's load hour
    # (a fresh cell, or a prior cell whose earlier use already finished - the instrument is
    # free). A later reuse of the same cell chains off that use's real movie end (the on-board
    # wash is now the reuse cell's own prep in cell_timing, not a load-time gap), so a long
    # (24-30h) movie starts its next-day reuse in the afternoon/evening rather than the flat load
    # hour - never before the cells have physically finished their previous acquisition. The
    # chained start is used only while it still lands on the
    # very day the packer reserved for the reuse (which is weekday- and lock-aware); a chain
    # long enough to spill past that day (e.g. a 30h x 3-use cell) falls back to the load hour,
    # matching the packer's own day rather than silently floating the run to a later column.
    # This is only actually consumed below for a reuse that DIDN'T get bundled into Plate 2
    # (get_or_create_run derives a bundled Plate 2's real start itself, via reuse_plate_window,
    # off Plate 1's own real end - see below) - computed unconditionally anyway since it's
    # cheap and every assignment needs SOME start_hour/start_minute to pass through.
    # Advisory only (see AutoFillResult.reuse_timing_flags): cell_ref -> worst hours by which a
    # chained reuse's actual start (base_start, once the correctly-chained time doesn't land on
    # the packer's reserved day - see below) fell short of that cell's own prior use's real
    # movie end. Never rejects or reroutes the placement itself.
    reuse_wait_shortfall: dict[str, float] = {}
    assign_start: dict[int, datetime] = {}
    for cell_ref, uses in uses_by_cell_ref.items():
        prev_end: datetime | None = None
        for idx, a in enumerate(uses):
            # planned_window's start ([0]) doesn't depend on the movie length; the movie only
            # matters for chaining a reuse off the PRIOR use's real end, which is now that
            # prior sample's own movie time (a run can mix 12/24/30 movies well-by-well).
            base_start, _ = planned_window(a.run_date, _movie(a.sample), start_hour, start_minute)
            start = base_start
            if prev_end is not None:
                # The reuse loads when the prior movie ends; the on-board wash is the reuse cell's
                # own prep now (REUSE_PREP_H in cell_timing), not an extra gap on the load time.
                chained = prev_end
                if base_start <= chained and chained.date() == a.run_date:
                    start = chained
                elif start < chained:
                    shortfall = (chained - start).total_seconds() / 3600
                    reuse_wait_shortfall[cell_ref] = max(shortfall, reuse_wait_shortfall.get(cell_ref, 0.0))
            assign_start[id(a)] = start
            # The prior use's real movie END (load + prep + movie, the one timing model); the next
            # use can't load before then. A cell's later uses (idx>0) carry the on-board wash too.
            prev_end = coarse_movie_end(start, _movie(a.sample), is_reuse=idx > 0)

    # A cycle (one plate of one run) starts at the latest start among its wells - all equal in
    # practice (a plate's wells are one reuse-generation), but the max keeps a mixed
    # fresh+reuse plate (not produced by the current packer, but cheap to guard) from ever
    # starting a reused well before its cells are physically free. Keyed by the (possibly
    # redirected) load_date/plate_index a bundled reuse actually lands under, not its own
    # acquire day.
    cycle_start: dict[tuple[str, date, int], datetime] = {}
    for a in fill.assignments:
        key = (a.instrument_serial, load_date_of[id(a)], plate_index_of[id(a)])
        s = assign_start[id(a)]
        if key not in cycle_start or s > cycle_start[key]:
            cycle_start[key] = s

    # A cycle (one plate) stays busy until its LONGEST well finishes, so its representative
    # movie length is the max movie time across its wells - used to gate the new run's
    # instrument lock at creation. Each well still records its own movie on its CellUse;
    # recompute_cycle_timing at the end re-derives movie_hours from those, so this only has to
    # be a safe upper bound for the lock gate, never the final stored value.
    cycle_movie: dict[tuple[str, date, int], int] = {}
    for a in fill.assignments:
        key = (a.instrument_serial, load_date_of[id(a)], plate_index_of[id(a)])
        m = _movie(a.sample)
        if key not in cycle_movie or m > cycle_movie[key]:
            cycle_movie[key] = m

    run_plate_cycles: dict[tuple[str, date, int], int] = {}  # (instrument, load_date, plate) -> cycle id
    run_ids: set[int] = set()
    skipped_keys: set[tuple[str, date]] = set()  # (instrument, load_date) runs whose creation was locked out
    touched_cells: set[Cell] = set()
    placed_sample_ids: list[int] = []
    sample_acquire_dates: dict[int, date] = {}  # sample_id -> the day it actually acquires (see AutoFillResult)
    # Populated both inline (the collision-retirement branch below, the moment a same-batch
    # reload needs a dial-exhausted tray's box back) and by the end-of-batch sweep further
    # down (for a tray that reached the dial but was never fought over mid-batch) - see
    # _dispose_tray_if_fully_used.
    disposed_cell_ids: list[int] = []
    # fill_slots plans every slot as 8 fully-free wells (SlotInput's own documented
    # invariant) - true for a brand-new run, but no longer true once the occupied-check
    # above started letting a cancelled-only cycle through (its one cancelled CellUse
    # still occupies its well, permanently). Track which wells are actually taken per
    # cycle, seeded from the DB the first time each cycle_id is touched, and reassign a
    # colliding assignment to the next free well instead of letting the unique
    # (cycle_id, well) constraint raise mid-batch.
    occupied_wells: dict[int, set[str]] = {}
    # (instrument_id, box_start) -> {home_well: Cell} for every physical tray-of-4 this
    # batch has opened so far, keyed the same way open_new_tray() derives a box from a
    # well (see below). Several fresh cells can land in different wells of the *same*
    # box within one auto-fill call (e.g. filling all 4 first-use wells of "tray 1" at
    # once) - without this cache each would independently open its own brand-new
    # CellTray, producing 4 physical trays (and non-sequential cell ids) for what's
    # really one tray box being loaded.
    opened_boxes: dict[tuple[int, int], dict[str, Cell]] = {}
    # (instrument_id, well) -> the PackedCell.id currently resolved to that exact well -
    # tracked per well, not per box, since several *different* fresh PackedCells
    # legitimately share one box at once (one per well - see opened_boxes above). Lets
    # the loop below tell "the same logical cell, resolved again" apart from "a
    # *different* PackedCell now needs this exact well because the engine already proved
    # its previous occupant genuinely exhausted its full physical lifetime" (see
    # slot_scheduling.py's well_owner/_well_is_vacated - fill_slots only ever hands an
    # already-claimed well to a new PackedCell once that's true, e.g. a fresh cell hits
    # its 3-use cap by midweek and a brand-new tray is planned into the same well
    # position later in the same batch).
    well_claimant: dict[tuple[int, str], str] = {}
    now = utcnow()

    def _resolve_well(cycle_id: int, requested_well: str) -> str | None:
        taken = occupied_wells.get(cycle_id)
        if taken is None:
            taken = {row[0] for row in db.execute(select(CellUse.well).where(CellUse.cycle_id == cycle_id)).all()}
            occupied_wells[cycle_id] = taken
        if requested_well not in taken:
            return requested_well
        # Only search within the wells this batch is actually allowed to use - falling
        # back past cells_per_day would silently load a second tray on a day the user
        # capped to one.
        return next((w for w in WELLS[:cells_per_day] if w not in taken), None)

    # Process in chronological order per instrument (not pack/cell order) rather than
    # fill.assignments' own order. A full-tray run's lock can span into the next calendar
    # day (see instrument_lock.run_lock_until), and that "tray 2 loaded" state is read
    # back from the CellUse rows just persisted for the earlier day - so the earlier day's
    # cell uses must already be committed before the later day's run is created, or the
    # lock goes undetected. The pre-scan above can't foresee a lock this batch is about to
    # create for itself; if that surfaces here as a PlacementError, skip just this day
    # (same as an already-locked day is skipped above) instead of letting it raise mid-loop
    # and roll back every other day already placed.
    for a in sorted(fill.assignments, key=lambda a: (a.instrument_serial, a.run_date)):
        load_date = load_date_of[id(a)]
        acquire_date = acquire_date_of[id(a)]
        plate_index = plate_index_of[id(a)]
        run_key = (a.instrument_serial, load_date)
        if run_key in skipped_keys:
            continue
        plate_key = (a.instrument_serial, load_date, plate_index)
        cycle_id = run_plate_cycles.get(plate_key)
        if cycle_id is None:
            cyc_start = cycle_start[plate_key]
            try:
                cyc = get_or_create_run(
                    db,
                    instrument=instruments[a.instrument_serial],
                    load_date=load_date,
                    plate_index=plate_index,
                    # A bundled reuse (acquire_date > load_date, Plate 1 already real in this
                    # run_batch) makes get_or_create_run derive the real chained start itself
                    # via reuse_plate_window, off Plate 1's own real timing - cyc_start below
                    # is then ignored. Everything else (Plate 1, or a fresh parallel Plate 2)
                    # uses cyc_start as its own chained/load-hour start, same as before.
                    acquire_date=acquire_date,
                    run_time_hours=cycle_movie[plate_key],
                    start_hour=cyc_start.hour,
                    start_minute=cyc_start.minute,
                )
            except PlacementError:
                skipped_keys.add(run_key)
                skipped.append(run_key)
                continue
            cycle_id = cyc.id
            run_plate_cycles[plate_key] = cycle_id
            run_ids.add(cyc.run_batch_id)

        well = _resolve_well(cycle_id, a.well)
        if well is None:
            # Every well in this cycle is already spoken for (a pre-existing marker plus
            # this batch's own earlier assignments) - this sample can't land here after
            # all; leave it unplaced rather than crash on a well collision.
            continue
        if well != a.well and a.cell.prior:
            # a.cell is a real, already-persisted Cell that fill_slots confined to
            # exactly a.well (its actual pinned well) - reassigning it here would
            # silently relocate a physical cell that can't actually move. Only a
            # pre-existing marker (e.g. a cancelled-only leftover) could ever collide
            # with a real pin in the first place; drop this placement rather than
            # violate the "same cell, same well, for life" invariant. A *fresh* cell
            # (not yet a real row) has no such physical commitment yet, so it's still
            # safe to let the reassignment below land it on a different free well.
            continue

        db_cell = ref_to_cell.get(a.cell.id)
        if db_cell is None:
            instrument_id = instruments[a.instrument_serial].id
            box_start = (WELLS.index(well) // CELLS_PER_TRAY) * CELLS_PER_TRAY
            box_key = (instrument_id, box_start)
            box_cells = opened_boxes.get(box_key)
            if box_cells is not None and well_claimant.get((instrument_id, well)) not in (None, a.cell.id):
                # A *different* PackedCell now needs this exact well - the engine already
                # proved this box's cells are genuinely done with THIS batch's own plan
                # (see slot_scheduling.py's _well_is_vacated: batch_capacity_reached, not
                # necessarily physically exhausted), so it's legitimate to retire the old
                # physical tray and load a brand-new one in its place, even within this
                # same batch. Explicitly dispose it right now (rather than waiting for
                # this function's own end-of-loop sweep below) so open_new_tray()'s own
                # "is this box still live" collision guard sees it as already gone, not a
                # stale "open" row - recompute_status() alone would never flip it away
                # from "open" here, since a dial below the physical 3-use cap means the
                # cell's real capacity isn't actually spent, only this batch's plan for it
                # is. If some sibling in this box *hasn't* actually reached the dial (a
                # real, uneven-quota edge case), _dispose_tray_if_fully_used leaves the
                # whole tray untouched and open_new_tray()'s guard correctly refuses the
                # reopen, leaving this sample unplaced rather than corrupting anything.
                # Every well in the box is cleared below, not just this one, so its other
                # siblings (already resolved earlier under the old generation) don't each
                # independently re-trigger this same retirement once their own next
                # assignment comes through.
                old_tray_id = next(iter(box_cells.values())).tray_id
                if old_tray_id is not None:
                    disposed_cell_ids.extend(_dispose_tray_if_fully_used(db, old_tray_id, max_uses, now))
                for old_cell in box_cells.values():
                    db.refresh(old_cell, attribute_names=["cell_uses"])
                    recompute_status(old_cell, now)
                # This session runs with autoflush=False (db.py) - without an explicit
                # flush here, the status changes above stay pending Python-side and
                # open_new_tray()'s own raw `Cell.status == "open"` collision query
                # below wouldn't see them yet, so it would wrongly still find these
                # cells "open" and refuse the legitimate reopen.
                db.flush()
                for w in WELLS[box_start : box_start + CELLS_PER_TRAY]:
                    well_claimant.pop((instrument_id, w), None)
                box_cells = None
                opened_boxes.pop(box_key, None)
            if box_cells is None:
                # Opens a whole new physical tray (4 cells), not just this one - the
                # other 3 are left open/unused and surface as preferred reuse candidates
                # on the next placement/auto-fill call (see open_new_tray()). load_prior_cells
                # should already have offered any pre-existing box's siblings as prior
                # candidates, so open_new_tray() raising here (its box-collision guard)
                # would mean the pre-batch snapshot missed a box opened earlier in this
                # same loop under a different key, or drifted from the DB some other way -
                # leave this one sample unplaced rather than roll back the whole batch.
                try:
                    # Key by tray POSITION, not home_well: open_new_tray may load the fresh tray
                    # into the OTHER cell-tray bay (its home wells then differ from this display
                    # box's wells - a plate can be backed by either bay), so resolve each display
                    # well to the tray's cell at the SAME position. founding_date lets an expired
                    # resident tray count as removed, matching the manual path.
                    box_cells = {
                        within_tray_pos(c.home_well): c
                        for c in open_new_tray(db, instrument_id, well, founding_date=acquire_date)
                    }
                except ValueError:
                    continue
                opened_boxes[box_key] = box_cells
            well_claimant[(instrument_id, well)] = a.cell.id
            db_cell = box_cells[within_tray_pos(well)]
            ref_to_cell[a.cell.id] = db_cell

        cell_use = CellUse(
            cycle_id=cycle_id,
            cell_id=db_cell.id,
            sample_id=a.sample.sample_id,
            well=well,
            # Each well runs for its OWN sample's movie time (12/24/30) now that Auto Schedule
            # is movie-time aware, so a run's wells can differ (e.g. a 12h cell 1 alongside a
            # 30h cell 4). The plate's representative movie_hours is re-derived from these as
            # the longest well by recompute_cycle_timing after the loop - same as the manual
            # placement path, and as editing a single cell's run time from the slot popover.
            run_time_hours=int(_movie(a.sample)),
            status="planned",
        )
        db.add(cell_use)
        db.flush()
        occupied_wells[cycle_id].add(well)
        for bc in a.sample.barcodes:
            db.add(CellUseBarcode(cell_use_id=cell_use.id, barcode=bc))
        touched_cells.add(db_cell)
        if a.sample.sample_id is not None:
            placed_sample_ids.append(a.sample.sample_id)
            # The day this sample actually ACQUIRES (sequences), not the run's own load_date -
            # for a bundled Plate 2 these differ, and it's the acquire day that matters to a
            # lab user (see AutoFillResult.sample_acquire_dates / day_changed_sample_ids).
            sample_acquire_dates[a.sample.sample_id] = acquire_date

    if placed_sample_ids:
        # Also clear any Cell-QC "recoverable"/"repeatable" tag, mirroring place_sample's own
        # scheduling side effect (placement_service.place_sample) - otherwise a sample swept up
        # here by Auto Schedule/Recalculate keeps a stale tag even though it's genuinely
        # scheduled again.
        db.execute(
            update(Sample).where(Sample.id.in_(placed_sample_ids)).values(status="scheduled", qc_disposition=None)
        )

    # A run can now mix movie times well-by-well (a 12h cell 1 beside a 30h cell 4), so each
    # touched plate's representative movie_hours / planned_end_at must be re-derived as the
    # longest of its actual wells - exactly the recompute the manual placement path already
    # runs. planned_start_at (incl. a reuse's chained start) is left untouched.
    for cycle_id in set(run_plate_cycles.values()):
        cyc = db.get(Cycle, cycle_id)
        if cyc is not None:
            recompute_cycle_timing(db, cyc)

    for db_cell in touched_cells:
        db.refresh(db_cell, attribute_names=["cell_uses"])
        recompute_status(db_cell, now)

    # --- auto-dispose: catches any tray that reached the "Max uses per cell" dial but
    #     was never fought over mid-batch (see _dispose_tray_if_fully_used - the persist
    #     loop's collision-retirement branch above already handles the common case where a
    #     same-batch reload needed the box back sooner). Still needed here for a tray that
    #     hit the dial on its last offered day, with nothing left in this batch to reuse
    #     its well - it must still be disposed so a LATER, separate Auto Schedule call sees
    #     an open box to reload, not a stale "open" tray with no capacity anyone can use.
    candidate_tray_ids: set[int] = {c.tray_id for c in touched_cells if c.tray_id is not None}
    for box_cells in opened_boxes.values():
        candidate_tray_ids.update(c.tray_id for c in box_cells.values() if c.tray_id is not None)

    for tray_id in candidate_tray_ids:
        disposed_cell_ids.extend(_dispose_tray_if_fully_used(db, tray_id, max_uses, now))
    if disposed_cell_ids:
        db.flush()

    # --- window flags: planned-only spans from the engine, plus a real-anchor check for
    #     prior cells whose true elapsed lifetime (from first_use_started_at) is at risk ---
    flag_span: dict[str, float] = {}

    def _bump(code: str, span: float) -> None:
        if code not in flag_span or span > flag_span[code]:
            flag_span[code] = span

    for wf in fill.window_flags:
        db_cell = ref_to_cell.get(wf.cell)
        _bump(db_cell.code if db_cell else wf.cell, wf.span)

    last_date_by_ref: dict[str, date] = {}
    for a in fill.assignments:
        if (a.instrument_serial, load_date_of[id(a)]) in skipped_keys:  # its run's creation may have been skipped
            continue
        cur = last_date_by_ref.get(a.cell.id)
        if cur is None or a.run_date > cur:
            last_date_by_ref[a.cell.id] = a.run_date

    for pc in pack.cells:
        if not pc.prior or pc.id not in last_date_by_ref:
            continue
        db_cell = ref_to_cell[pc.id]
        started = db_cell.first_use_started_at
        if started is None:
            continue
        # Measure to the last use's *start*, not its end: the 108h window is defined on when
        # the later use starts (see docs/pacbio-sprq-nx-scheduling-reference.md #2 and
        # _reuse_window_open), so planned_window()[0] (start), not [1] (end). The movie length
        # passed here is irrelevant - only [0] (the start) is read - so any value serves.
        planned_start = planned_window(last_date_by_ref[pc.id], DEFAULT_MOVIE_HOURS, start_hour, start_minute)[0]
        span_h = (planned_start - ensure_aware(started)).total_seconds() / 3600
        if span_h > CELL_LIFETIME_H:
            _bump(db_cell.code, span_h)

    # Advisory only, a distinct clock from the 108h window_flags above (see
    # AutoFillResult.reuse_timing_flags and the assign_start loop that populates
    # reuse_wait_shortfall): resolve each flagged cell_ref to its real Cell code the same way
    # window_flags does, falling back to the raw ref if this batch never persisted that cell.
    reuse_timing_flags = [
        (ref_to_cell[ref].code if ref in ref_to_cell else ref, hours) for ref, hours in reuse_wait_shortfall.items()
    ]

    placed_set = set(placed_sample_ids)
    unplaced_sample_ids = [s.id for s in samples if s.id not in placed_set]

    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="auto_fill",
            entity_type="cycle",
            entity_id=None,
            details_json={
                "placed": len(placed_sample_ids),
                "unplaced": len(unplaced_sample_ids),
                "skipped": len(skipped),
                "runs": len(run_ids),
                "disposed": len(disposed_cell_ids),
            },
        )
    )
    db.commit()

    return AutoFillResult(
        placed_sample_ids=placed_sample_ids,
        unplaced_sample_ids=unplaced_sample_ids,
        skipped_cells=skipped,
        window_flags=[(code, span) for code, span in flag_span.items()],
        reuse_timing_flags=reuse_timing_flags,
        barcode_conflicts=pack.conflict_pairs,
        run_ids=list(run_ids),
        disposed_cell_ids=disposed_cell_ids,
        sample_acquire_dates=sample_acquire_dates,
    )


def recalculate_instrument(db: Session, *, instrument_serial: str, actor: str | None = None) -> AutoFillResult:
    """Re-derive every not-yet-loaded (planned) placement on one instrument from scratch,
    using the exact same reuse-before-new engine Auto Schedule already uses (pack_cells +
    fill_slots) - the "Recalculate" action next to an instrument's name in the weekly grid.
    For cases the engine packed under an older or since-corrected rule (e.g. before the
    barcode-clash guard learned to exempt a duplicate Container ID's own earlier copy - see
    docs/pacbio-sprq-nx-scheduling-reference.md) and needs re-packing under the current one,
    without the user manually clearing and replacing each sample by hand.

    Scope is deliberately narrow: only the samples already scheduled on THIS instrument's
    planned (unconfirmed) runs are re-packed - never the wider backlog, so recalculating one
    instrument can't reach across and reassign an unrelated sample sitting on a different
    instrument, or one that's genuinely still unscheduled. A LOADED/confirmed run is never
    touched: its cells are physically already on the instrument in reality, so there is
    nothing to recompute - this mirrors every other mutation in this module, which only ever
    acts on a `planned` cycle.

    Bulk-unschedules the affected placements back to the backlog first (the same atomic
    remove_samples() "Clear schedule" already uses, so a partial failure can't strand a
    half-cleared day), then re-runs auto_fill() restricted to exactly those sample ids - full
    3-use depth, every movie time, both trays, "fewest" (deepen reuse before opening a new
    cell), so recalculate itself never strands a sample behind a restrictive dial it didn't
    choose. Any sample that no longer fits (e.g. a barcode conflict introduced by something
    scheduled elsewhere in the meantime) is left safely in the backlog and reported as
    unplaced, never dropped.

    The day-slots offered to auto_fill() are the instrument's existing planned load_dates,
    EXTENDED forward (weekdays only) until at least CELL_MAX_USES distinct days are on offer
    (never truncated - an instrument already spanning more days keeps every one of them).
    Without this, "full 3-use depth" above is only actually reachable when the pre-existing
    footprint already happened to span >=3 days: pack_cells() caps every fresh cell's depth at
    `min(max_uses, available_days)` (see engine/packing.py), and available_days is just the
    count of days auto_fill() is handed - so a schedule that (before this recalculate) sat
    entirely on ONE day silently capped every cell to Use 1 and forced open as many distinct
    physical trays as wells were needed that day, even though "fewest" was explicitly
    requested (reported 2026-07-29: 8 same-day placements opened two fresh trays instead of
    reusing one tray's 4 cells twice each across two days). Extending forward is safe: a
    candidate day auto_fill() can't actually use (already occupied, instrument-locked, or
    past a maintenance down_from) is skipped by its own pre-scan exactly as today, it just
    never gets to help if never offered.

    Since this can now genuinely move a sample onto a day it wasn't on before (not just a
    different cell/tray), day_changed_sample_ids on the returned result flags exactly which
    samples that happened to - surfaced separately from an ordinary cell/tray reassignment
    because a day change has real lab-operational impact a cell swap doesn't."""
    instrument = db.scalar(select(Instrument).where(Instrument.serial_number == instrument_serial))
    if instrument is None:
        raise PlacementError(400, f"Unknown instrument serial '{instrument_serial}'.")

    planned_cycles = (
        db.scalars(
            select(Cycle)
            .join(Cycle.run_batch)
            .where(RunBatch.instrument_id == instrument.id, Cycle.status == "planned")
            .options(selectinload(Cycle.run_batch), selectinload(Cycle.cell_uses))
        )
        .unique()
        .all()
    )

    live_uses = [cu for c in planned_cycles for cu in c.cell_uses if cu.status != "cancelled"]
    if not live_uses:
        return AutoFillResult()  # nothing planned on this instrument right now - no-op

    # The day each sample actually acquired BEFORE this recalculate (a plate's own
    # acquire_date, not its run's load_date - they can already differ pre-recalculate for a
    # manually-placed intra-run reuse Plate 2).
    before_day_by_sample: dict[int, date] = {
        cu.sample_id: c.acquire_date
        for c in planned_cycles
        for cu in c.cell_uses
        if cu.status != "cancelled" and cu.sample_id is not None
    }
    load_dates = sorted({c.run_batch.load_date for c in planned_cycles})
    cell_use_ids = [cu.id for cu in live_uses]
    sample_ids = [cu.sample_id for cu in live_uses if cu.sample_id is not None]

    # Extend forward (weekdays only) until at least CELL_MAX_USES distinct days are on offer -
    # never fewer than the existing footprint, never more days than the depth could ever use.
    extended_dates = list(load_dates)
    cursor = extended_dates[-1]
    while len(extended_dates) < CELL_MAX_USES:
        cursor += timedelta(days=1)
        if cursor.weekday() < 5:
            extended_dates.append(cursor)

    remove_samples(db, cell_use_ids, actor)

    cells = [_CellRef(instrument_serial=instrument_serial, load_date=d) for d in extended_dates]
    result = auto_fill(
        db,
        cells=cells,
        max_uses=CELL_MAX_USES,
        movie_times=[12, 24, 30],
        objective="fewest",
        cells_per_day=len(WELLS),
        sample_ids=sample_ids,
        actor=actor,
    )
    result.day_changed_sample_ids = [
        sid
        for sid, before in before_day_by_sample.items()
        if sid in result.sample_acquire_dates and result.sample_acquire_dates[sid] != before
    ]
    return result
