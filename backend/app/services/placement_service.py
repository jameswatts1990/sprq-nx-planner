"""Interactive placement: users drag one sample onto one (instrument, load_date, slot) grid
cell at a time. Each placement gets-or-creates the run - a RunBatch keyed (instrument,
load_date) - plus the specific plate (a Cycle, plate_index 1|2) the slot lands in, resolves
a fresh or reused SMRT-cell, and records the CellUse.

A run holds 1-2 plates (Run->Plate model). Plate 1 acquires on the load day; a fresh Plate 2
(a second tray) acquires the same day (parallel), while a Plate 2 that reuses Plate 1's cells
acquires the next day (sequential, after the on-board wash) - all loaded in one session. That
next day may be a weekend: the operator loads on a weekday, but the machine re-runs the reuse
plate unattended the following calendar day (see the weekend-cadence note in
docs/pacbio-sprq-nx-scheduling-reference.md). Only LOAD dates are weekday-only.

Errors are raised as PlacementError(status_code, detail); the API layer maps them to
HTTPExceptions. Validation is done read-only before any DB writes so a rejected request
never leaves half-written rows in a shared session."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.engine.constants import (
    DAY_START_HOUR,
    DEFAULT_MOVIE_HOURS,
    WELLS,
    within_tray_pos,
)
from app.services.cell_timing import coarse_movie_end
from app.models.audit import AuditLog
from app.models.cell import Cell
from app.models.cell_tray import CellTray
from app.models.instrument import Instrument
from app.models.sample import Sample
from app.models.schedule import CellUse, CellUseBarcode, Cycle, RunBatch
from app.services import instrument_lock
from app.services.cell_service import (
    cleanup_tray_if_fully_unused,
    current_location,
    derive_cell_state,
    first_use_planned_start_at,
    open_new_tray,
    recompute_status,
    reuse_deadline,
    run_has_started,
    use_run_date,
    use_sort_key,
)
from app.services.engine_bridge import load_prior_cells
from app.timeutil import ensure_aware, utcnow

# A run's two loading positions (deck trays). slot_index 0-3 = Plate 1, 4-7 = Plate 2.
PLATE_SIZE = len(WELLS) // 2  # 4


class PlacementError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _next_day(d: date) -> date:
    """The calendar day immediately after `d` - where a reuse Plate 2 acquires (the instrument
    washes and re-runs the same cells the next day). This is a *sequencing* day, not a load day:
    the operator loads both plates on the run's weekday `load_date`, and the reuse plate then
    sequences the following calendar day even if that is a weekend - the machine runs unattended,
    so a reuse acquisition is not weekday-bound the way a fresh load is (lab runs weekends; see
    docs/pacbio-sprq-nx-scheduling-reference.md's weekend-cadence note). Load dates stay
    weekday-only, guarded in place_sample/auto_fill. Only an advisory floor for the reuse window
    check; the real acquire day/time is derived by reuse_plate_window off Plate 1's movie end."""
    return d + timedelta(days=1)


def planned_window(
    acquire_date: date, run_time_hours: float, start_hour: int = DAY_START_HOUR, start_minute: int = 0
) -> tuple[datetime, datetime]:
    start = datetime.combine(acquire_date, time(hour=start_hour, minute=start_minute), tzinfo=timezone.utc)
    return start, start + timedelta(hours=run_time_hours)


def reuse_plate_window(
    plate1_start: datetime, plate1_movie_hours: float, reuse_movie_hours: float
) -> tuple[date, datetime, datetime]:
    """Timing for a reuse Plate 2, chained from Plate 1's real movie end - so the reuse's day
    reflects the movie length, not a fixed 'next day'.

    The reuse Plate 2 loads the moment Plate 1's movie finishes, i.e. Plate 1's load + its PREP_H
    prep + its movie (the same prep-then-movie the one timing model uses - see cell_timing; the
    reuse can't start before the cell physically stops sequencing its prior use). PREP_H is Plate
    1's first-use prep (the common case for the load-day plate); the reuse cell's own on-board wash
    is NOT added here - it's the reuse's own prep in cell_timing (REUSE_PREP_H on top of PREP_H),
    counted once. A 24-30h movie loaded midday lands the reuse the following day; a late load or
    long movie can push it a further day.

    The reuse acquisition may land on a WEEKEND: the operator loads both plates on the run's
    weekday load_date, and the machine re-runs the reuse plate unattended when Plate 1's movie
    ends, whatever day that falls on (lab runs weekends; see the weekend-cadence note in
    docs/pacbio-sprq-nx-scheduling-reference.md). This is deliberately NOT rolled forward to a
    weekday - doing so used to push a Friday load's reuse to Monday, out of the cell's 108h
    window. Only LOAD dates stay weekday-only (guarded in place_sample/auto_fill), never a
    reuse's own sequencing day. Returns (acquire_date, planned_start, planned_end). See
    docs/pacbio-sprq-nx-scheduling-reference.md's "Instrument load-lock timing"."""
    start = coarse_movie_end(plate1_start, plate1_movie_hours)
    return start.date(), start, start + timedelta(hours=reuse_movie_hours)


def recompute_cycle_timing(db: Session, cycle: Cycle) -> None:
    """Re-derive a plate's representative run time from its wells after any placement change.

    Run time is stored per-well (CellUse.run_time_hours); a plate's Cycle.movie_hours is the
    *longest* of its non-cancelled wells - the instrument stays busy (and planned_end_at
    runs) until the last well finishes. Called after any add/move/remove/edit that can
    change which wells - or which run times - a plate holds. Cancelled wells (a stopped
    cell's permanent marker) never run, so they don't extend the window. If a plate has no
    live wells left, movie_hours/planned_end_at are left as-is (the plate is about to be
    deleted by the caller, or holds only a cancelled marker whose old timing is harmless).

    Queried straight off CellUse rather than through cycle.cell_uses: callers reach here
    mid-transaction after raw cycle_id reassignments (see move_sample), where the ORM
    relationship can be stale."""
    longest = db.scalar(
        select(func.max(CellUse.run_time_hours)).where(
            CellUse.cycle_id == cycle.id, CellUse.status != "cancelled"
        )
    )
    if longest is None:
        return
    cycle.movie_hours = int(longest)
    cycle.planned_end_at = ensure_aware(cycle.planned_start_at) + timedelta(hours=int(longest))


def _reuse_priority_key(cell: Cell) -> tuple[int, float, int]:
    """Order cells the way the instrument reaches for them: most-used first (its 108h clock is
    nearest expiry - "expiring next"), then earliest first-use, then tray position (1->4). The
    single ordering used BOTH to pick which cell a drop reuses (_pick_next_reuse_cell) and to
    lay a plate's wells onto its cells (_resequence_plate), so "which cell is next" and "which
    well shows which cell" can never disagree. See docs/pacbio-sprq-nx-scheduling-reference.md's
    reuse-before-new priority (#5) and "Sequential wells take sequential cells"."""
    consumed = derive_cell_state(cell)[0]
    started = cell.first_use_started_at or first_use_planned_start_at(cell)
    started_key = ensure_aware(started).timestamp() if started is not None else float("inf")
    pos = cell.tray_position if cell.tray_position is not None else 99
    return (-consumed, started_key, pos)


def _fresh_tray_cell(cells: list[Cell]) -> Cell:
    """The cell a drop takes when a brand-new tray is opened: its NEXT-AVAILABLE cell = tray
    position 1, regardless of which loading well was dropped on. "The well takes the next
    available cell, not the well-position-matched one" (lab-owner model). For the common
    start-at-A drop this is unchanged (A01 is position 1); it only matters when the first drop
    onto a fresh tray lands on a later well (e.g. a lone C01), which must still read cell 1, not
    cell 3. _resequence_plate keeps the whole plate ascending as further wells fill in."""
    return min(cells, key=lambda c: c.tray_position if c.tray_position is not None else 99)


def _resequence_plate(db: Session, cycle: Cycle) -> None:
    """Lay a still-planned plate's occupied wells onto its cells so that, read in well order
    (A->B->C->D), the wells are backed by the plate's cells in reuse-priority order (expiring-
    first, then tray sequence 1,2,3,4 - see _reuse_priority_key). Every sample stays in the
    exact well it was dropped onto; only which physical cell backs each well is re-zipped, so a
    plate can never render an out-of-order cell number - the forbidden A=1,B=4,C=3,D=2 state the
    lab owner reported. Called after every placement/move/removal that can change a plate's set
    of wells or cells. See docs/pacbio-sprq-nx-scheduling-reference.md's "Sequential wells take
    sequential cells".

    A pure permutation of the plate's existing cells across its existing wells: each cell keeps
    exactly one use on this plate, so every cell's consumed count (hence its priority) is
    invariant under the remap - the order is computed once from the current state and is stable,
    never oscillating. Barcodes ride with their CellUse (CellUseBarcode is keyed by cell_use_id),
    so a clash a remap surfaces is simply re-derived and flagged on the card, never blocked
    (lab-owner decision: warn, don't block). Only touches a `planned` plate - a confirmed/loaded
    plate is physically committed. Safe against the DB constraints: (cycle_id, well) is untouched
    (wells never move here) and there is no (cycle_id, cell_id) constraint, so the transient
    mid-loop state where two uses momentarily point at one cell can't violate anything."""
    if cycle.status != "planned":
        return
    # Queried straight off CellUse (not cycle.cell_uses): callers reach here right after a raw
    # cycle_id insert / reassignment whose ORM collection can still be stale (same reason
    # recompute_cycle_timing queries directly). Each cell's own uses + their cycles are eager-
    # loaded so _reuse_priority_key can derive consumed count and first-use start without N+1.
    live = list(
        db.scalars(
            select(CellUse)
            .where(CellUse.cycle_id == cycle.id, CellUse.status != "cancelled")
            .options(
                selectinload(CellUse.cell)
                .selectinload(Cell.cell_uses)
                .selectinload(CellUse.cycle)
            )
        ).all()
    )
    live = [cu for cu in live if cu.cell is not None]
    if len(live) < 2:
        return
    wells_ascending = sorted(live, key=lambda cu: within_tray_pos(cu.well))
    cells_by_priority = sorted((cu.cell for cu in live), key=_reuse_priority_key)
    changed = False
    for cu, cell in zip(wells_ascending, cells_by_priority):
        if cu.cell_id != cell.id:
            cu.cell = cell
            changed = True
    if changed:
        db.flush()


def update_run_load_time(db: Session, run_batch: RunBatch, start_hour: int, start_minute: int = 0) -> None:
    """Amend a run's load time - the hour it loads (its cells then prep before sequencing) - re-deriving every
    plate's window from it. Called when the operator records/corrects the real load time at
    Confirm-loaded (see api/cycles.patch_run). Plate 1 moves to the chosen time on the run's
    own load_date; a same-day parallel Plate 2 loads with it; a reuse Plate 2 (a later
    acquire_date) is re-chained off Plate 1's new movie end via reuse_plate_window, so its
    day/time still reflects the movie length.

    Deliberately NOT re-gated against a prior run's instrument lock: unlike creating a new run,
    this records/corrects reality for an existing one, so it never raises. Caller owns the
    commit."""
    cycles = sorted(run_batch.cycles, key=lambda c: c.plate_index)
    plate1 = next((c for c in cycles if c.plate_index == 1), None)
    if plate1 is None:
        return
    load_date = run_batch.load_date
    new_start = datetime.combine(load_date, time(hour=start_hour, minute=start_minute), tzinfo=timezone.utc)
    plate1.planned_start_at = new_start
    recompute_cycle_timing(db, plate1)  # planned_end_at + representative movie_hours from wells

    for plate in cycles:
        if plate.plate_index == 1:
            continue
        if plate.acquire_date > load_date:
            # Reuse Plate 2: rerun Plate 1's cells once its movie finishes (the on-board wash is
            # the reuse cell's own prep now, in cell_timing, not a load-time gap here).
            acquire_date, start, end = reuse_plate_window(plate1.planned_start_at, plate1.movie_hours, plate.movie_hours)
            plate.acquire_date = acquire_date
            plate.planned_start_at = start
            plate.planned_end_at = end
        else:
            # Same-day parallel Plate 2 (a second tray): loaded in the same session as Plate 1.
            plate.planned_start_at = new_start
            recompute_cycle_timing(db, plate)


def reschedule_run(db: Session, run_id: int, new_load_date: date, actor: str | None = None) -> RunBatch:
    """Move a whole planned run (both plates) to a different weekday - the "instrument failed to
    load, run it another day" action, so the lab moves the run in one step instead of dragging
    every sample. Each plate keeps its cells, samples, barcodes and per-cell run times; only the
    day (and, for a reuse Plate 2, its chained acquire day/time) changes.

    Use numbers are derived live, so they renumber themselves. A reuse pushed past its cell's 108h
    window is deliberately NOT auto-changed here - it comes back flagged reuse_window_exceeded so
    the user can load a fresh tray from the slot/cell popover (the "flag, don't silently swap"
    product choice). Refuses (409) if the run is already confirmed loaded (its cells are physically
    in the instrument - unlock first), if new_load_date isn't a weekday, if the instrument is
    maintenance-down then, if a prior run locks the instrument all day, or if a run already exists
    on (instrument, new_load_date) - merging two runs isn't modelled; clear one first. Commits."""
    run_batch = db.scalar(
        select(RunBatch)
        .where(RunBatch.id == run_id)
        .options(selectinload(RunBatch.cycles).selectinload(Cycle.cell_uses), selectinload(RunBatch.instrument))
    )
    if run_batch is None:
        raise PlacementError(404, "Run not found.")
    if new_load_date.weekday() >= 5:
        raise PlacementError(409, "A run can only be loaded on a weekday.")
    if any(c.status != "planned" for c in run_batch.cycles):
        raise PlacementError(409, "This run is already confirmed loaded; unlock it before rescheduling.")
    if new_load_date == run_batch.load_date:
        return run_batch  # no-op

    instrument = run_batch.instrument
    if instrument.down_from is not None and new_load_date >= instrument.down_from:
        raise PlacementError(
            409,
            f"Instrument {instrument.serial_number} is down for maintenance from {instrument.down_from.isoformat()}.",
        )
    clash = db.scalar(
        select(RunBatch).where(RunBatch.instrument_id == instrument.id, RunBatch.load_date == new_load_date)
    )
    if clash is not None:
        raise PlacementError(
            409,
            f"A run already exists on {instrument.serial_number} on {new_load_date.isoformat()} - "
            "clear it first, or pick another day.",
        )

    # Preserve Plate 1's time-of-day and gate the new day against a prior run's whole-day loading
    # lock, exactly as creating a fresh run there would (get_or_create_run). Only a lock spanning
    # the whole target day blocks; a partial lock is advisory (see resolve_new_run_start).
    plate1 = next((c for c in run_batch.cycles if c.plate_index == 1), None)
    start_hour, start_minute = (
        (plate1.planned_start_at.hour, plate1.planned_start_at.minute) if plate1 else (DAY_START_HOUR, 0)
    )
    longest = max((c.movie_hours for c in run_batch.cycles), default=DEFAULT_MOVIE_HOURS)
    gate_start, _ = planned_window(new_load_date, longest, start_hour, start_minute)
    if instrument_lock.resolve_new_run_start(db, instrument.id, new_load_date, gate_start) is None:
        blocking = instrument_lock.latest_lock_until(db, instrument.id, new_load_date)
        raise PlacementError(
            409,
            f"Instrument {instrument.serial_number} is locked until "
            f"{blocking.isoformat() if blocking else '?'} by a prior run on {new_load_date.isoformat()}.",
        )

    # Capture which plates are a reuse (acquire > current load) BEFORE moving: once load_date
    # jumps forward, a reuse's old acquire day can fall *before* the new load day, so the stale
    # acquire_date can no longer classify it (unlike update_run_load_time's same-date edit, which
    # can). Then move the run and re-derive every plate off the new day - Plate 1 (and a same-day
    # parallel Plate 2) to the same time-of-day on the new date; a reuse Plate 2 re-chained off
    # Plate 1's new movie end via reuse_plate_window. The plates' cells and their relative reuse
    # priority are unchanged by a pure date shift, so no re-sequencing is needed.
    was_reuse = {c.id: c.acquire_date > run_batch.load_date for c in run_batch.cycles}
    new_start = datetime.combine(new_load_date, time(hour=start_hour, minute=start_minute), tzinfo=timezone.utc)
    run_batch.load_date = new_load_date
    if plate1 is not None:
        plate1.acquire_date = new_load_date
        plate1.planned_start_at = new_start
        recompute_cycle_timing(db, plate1)
    for cycle in run_batch.cycles:
        if cycle.plate_index == 1:
            continue
        if was_reuse[cycle.id] and plate1 is not None:
            acquire_date, start, end = reuse_plate_window(plate1.planned_start_at, plate1.movie_hours, cycle.movie_hours)
            cycle.acquire_date = acquire_date
            cycle.planned_start_at = start
            cycle.planned_end_at = end
        else:
            cycle.acquire_date = new_load_date
            cycle.planned_start_at = new_start
            recompute_cycle_timing(db, cycle)
    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="reschedule_run",
            entity_type="run_batch",
            entity_id=run_batch.id,
            details_json={"new_load_date": new_load_date.isoformat()},
        )
    )
    db.commit()
    db.refresh(run_batch)
    return run_batch


def _cell_used_in_run(cell: Cell, instrument_id: int, load_date: date, *, exclude_use_id: int | None = None) -> bool:
    """True if this physical cell already has a (non-cancelled) use in the run loaded on
    (instrument, load_date) - i.e. placing/moving it again into that run is an intra-run
    reuse (Plate 1 already holds it, this becomes the sequential Plate 2). Excludes the use
    being moved so a plain reschedule of that very use doesn't read as a reuse of itself."""
    for cu in cell.cell_uses:
        if cu.status == "cancelled" or cu.id == exclude_use_id:
            continue
        rb = cu.cycle.run_batch if cu.cycle else None
        if rb is not None and rb.instrument_id == instrument_id and rb.load_date == load_date:
            return True
    return False


def _plate_target(
    db: Session, *, cell: Cell | None, instrument_id: int, load_date: date, slot_index: int, exclude_use_id: int | None = None
) -> tuple[int, date]:
    """Work out (plate_index, acquire_date) for a placement/move into a given grid slot.

    - A cell already loaded in this run (intra-run reuse) is the run's sequential second
      plate: Plate 2, acquiring a later day. The date returned here (the next weekday) is only
      an advisory floor: get_or_create_run recomputes the real reuse day from Plate 1's movie
      length + on-board wash (see reuse_plate_window), so a long movie can push it out further.
    - Otherwise the plate comes from the slot block (0-3 -> Plate 1, 4-7 -> Plate 2) and it
      acquires on the load day - Plate 1, or a fresh parallel Plate 2 (a second tray), or a
      cross-run reuse of a cell whose last use was in an earlier run."""
    if cell is not None and _cell_used_in_run(cell, instrument_id, load_date, exclude_use_id=exclude_use_id):
        return 2, _next_day(load_date)
    plate_index = 1 if slot_index < PLATE_SIZE else 2
    return plate_index, load_date


def _load_existing_cycle(db: Session, *, instrument_id: int, load_date: date, plate_index: int) -> Cycle | None:
    """Read-only lookup of an already-created Plate (Cycle) in the run keyed by (instrument_id,
    load_date) - None if the run, or this plate_index within it, doesn't exist yet. Never
    creates anything (unlike get_or_create_run) - used to inspect what a placement would be
    joining, before any write."""
    run_batch = db.scalar(
        select(RunBatch)
        .where(RunBatch.instrument_id == instrument_id, RunBatch.load_date == load_date)
        .options(selectinload(RunBatch.cycles).selectinload(Cycle.cell_uses).selectinload(CellUse.cell))
    )
    if run_batch is None:
        return None
    return next((c for c in run_batch.cycles if c.plate_index == plate_index), None)


def _established_tray_id(cycle: Cycle | None) -> int | None:
    """Which physical tray (Cell.tray_id) `cycle` is already committed to, from the tray_id
    shared by its already-placed, non-cancelled cell_uses' cells. None if the cycle doesn't
    exist yet, has no live cell_uses, or every cell is a legacy/bootstrap cell with no tray_id
    (nothing fixed to check new candidates against - a tray-less cell is exempt from the
    one-tray-per-plate invariant, having no tray identity to compare). A Plate is one sample
    plate, physically backed by a single cell tray at a time - so every well of one Cycle must
    resolve to the same tray_id, never a mix (see docs/pacbio-sprq-nx-scheduling-reference.md).
    Deterministic (lowest tray_id) if pre-existing data is already split across trays - this
    does not retroactively repair that, only prevents a NEW split from being introduced."""
    if cycle is None:
        return None
    tray_ids = {
        cu.cell.tray_id
        for cu in cycle.cell_uses
        if cu.status != "cancelled" and cu.cell is not None and cu.cell.tray_id is not None
    }
    return min(tray_ids) if tray_ids else None


def get_or_create_run(
    db: Session,
    *,
    instrument: Instrument,
    load_date: date,
    plate_index: int,
    acquire_date: date,
    run_time_hours: float,
    start_hour: int = DAY_START_HOUR,
    start_minute: int = 0,
) -> Cycle:
    """Get-or-create the run (RunBatch keyed (instrument, load_date)) and the specific plate
    (Cycle with this plate_index) the placement lands in. A run holds 1-2 plates.

    A brand-new run's earliest start must not fall before a prior run's lock ends on this
    same instrument - only *creating a new run* is gated (adding a plate to, or a sample
    into, an existing run is never blocked), so loading the next run's cells while the
    current one is still sequencing remains possible.

    Safe against a concurrent drag into the same empty grid cell: on a losing INSERT race we
    roll back and re-SELECT the winner's row. NOTE: the rollback discards the whole pending
    transaction, so callers must invoke this before making any other DB writes they care
    about."""

    def _load_run_batch() -> RunBatch | None:
        return db.scalar(
            select(RunBatch)
            .where(RunBatch.instrument_id == instrument.id, RunBatch.load_date == load_date)
            .options(selectinload(RunBatch.cycles))
        )

    run_batch = _load_run_batch()

    if run_batch is None:
        # Gate new-run creation against a maintenance-down window: an instrument marked down
        # from a date refuses any brand-new run on/after that date (it stays greyed in the grid
        # too - see the frontend). Like the lock gate below, this only blocks *creating* a run;
        # adding a plate/sample to an already-existing run is never affected.
        if instrument.down_from is not None and load_date >= instrument.down_from:
            raise PlacementError(
                409,
                f"Instrument {instrument.serial_number} is down for maintenance from "
                f"{instrument.down_from.isoformat()}.",
            )
        # Gate new-run creation against a prior run's loading-lock, but DON'T silently move the
        # user's chosen load time any more. We record the time they picked; the lane-model
        # effective start (surfaced as a placement advisory - see instrument_lock.effective_run_start
        # / RunOut.effective_start_at) tells them when the cells will actually break out if the
        # machine is busy. Only a lock spanning the WHOLE load day still blocks the load outright
        # (the instrument is busy every hour of it), same as before - see resolve_new_run_start.
        gate_start, _ = planned_window(load_date, run_time_hours, start_hour, start_minute)
        if instrument_lock.resolve_new_run_start(db, instrument.id, load_date, gate_start) is None:
            blocking = instrument_lock.latest_lock_until(db, instrument.id, load_date)
            raise PlacementError(
                409,
                f"Instrument {instrument.serial_number} is locked until "
                f"{blocking.isoformat() if blocking else '?'} by a prior run.",
            )
        run_batch = RunBatch(instrument_id=instrument.id, load_date=load_date)
        db.add(run_batch)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            run_batch = _load_run_batch()
            if run_batch is None:
                raise

    existing = next((c for c in run_batch.cycles if c.plate_index == plate_index), None)
    if existing is not None:
        return existing

    # A reuse Plate 2 (a later-day plate, acquire_date > load_date) is chained off Plate 1's
    # real timing: the instrument finishes Plate 1's movie, washes, then re-runs the same
    # cells - so its day reflects the movie length rather than the caller's advisory date (a
    # flat "next weekday" from _plate_target, or the day auto-fill's packer happened to float
    # the reuse onto). A same-day parallel Plate 2 (a second fresh tray, acquire_date ==
    # load_date) keeps the load-day timing. See reuse_plate_window.
    plate1 = next((c for c in run_batch.cycles if c.plate_index == 1), None)
    if plate_index == 2 and acquire_date > load_date and plate1 is not None:
        acquire_date, start, end = reuse_plate_window(plate1.planned_start_at, plate1.movie_hours, run_time_hours)
    else:
        start, end = planned_window(acquire_date, run_time_hours, start_hour, start_minute)
    cycle = Cycle(
        run_batch_id=run_batch.id,
        plate_index=plate_index,
        acquire_date=acquire_date,
        movie_hours=int(run_time_hours),
        planned_start_at=start,
        planned_end_at=end,
        status="planned",
    )
    db.add(cycle)
    try:
        db.flush()
    except IntegrityError:
        # A concurrent drag created this same plate first - reuse the winner's row.
        db.rollback()
        run_batch = _load_run_batch()
        existing = next((c for c in run_batch.cycles if c.plate_index == plate_index), None) if run_batch else None
        if existing is None:
            raise
        return existing
    return cycle


def _cleanup_emptied_plate(db: Session, cycle: Cycle) -> tuple[bool, bool]:
    """After a plate loses a use, delete the plate (Cycle) if it has no cell_uses left, then
    delete the run (RunBatch) if that leaves it with no plates. A run holds 1-2 plates now,
    so an emptied plate no longer implies an emptied run - the *other* plate may still be
    live. Returns (plate_deleted, run_deleted). If the plate still has wells, its
    representative run time is re-derived and nothing is deleted."""
    remaining = db.scalar(select(func.count()).select_from(CellUse).where(CellUse.cycle_id == cycle.id))
    if remaining and remaining > 0:
        recompute_cycle_timing(db, cycle)
        return False, False
    run_batch = cycle.run_batch
    run_batch_id = cycle.run_batch_id
    # Refresh the (possibly stale) in-memory collection: a move re-points a CellUse's cycle via
    # the relationship, but this plate's cell_uses collection can still list it until reloaded -
    # so the cascade delete would otherwise try to re-delete a use that's now on another plate.
    db.refresh(cycle, attribute_names=["cell_uses"])
    db.delete(cycle)
    db.flush()
    plates_left = db.scalar(select(func.count()).select_from(Cycle).where(Cycle.run_batch_id == run_batch_id))
    if not plates_left and run_batch is not None:
        db.refresh(run_batch, attribute_names=["cycles"])  # collection now empty -> clean cascade
        db.delete(run_batch)
        return True, True
    return True, False


def _release_cell(db: Session, cell: Cell, now: datetime) -> None:
    """Shared cleanup once a cell loses one of its uses - remove_sample and move_sample's
    cell-reassignment path both hit exactly this same decision: recompute status if the cell
    still has other uses, delete it outright if it was only ever a placeholder for the use
    just lost (no tray backing it - it can never legitimately exist as an orphan "open, 0/3"
    cell), or otherwise leave it open as a real physical tray sibling unless every sibling in
    its tray is also down to 0 uses."""
    db.refresh(cell, attribute_names=["cell_uses"])
    if cell.cell_uses:
        recompute_status(cell, now)
    elif cell.tray_id is None:
        db.delete(cell)
    else:
        cleanup_tray_if_fully_unused(db, cell)


def _resolve_cell_choice(
    db: Session,
    cell_choice: dict,
    *,
    instrument_id: int,
    instrument_serial: str,
    well: str,
    acquire_date: date,
    load_date: date,
    plate_index: int,
) -> Cell:
    """Shared "which cell hosts this sample" resolution, shared by place_sample and
    move_sample's cell-reassignment path: mode "new" opens a fresh tray at plate position
    `well`; mode "existing" validates the chosen cell is open, has capacity, is on this same
    instrument (a physical cell never crosses instruments), belongs to the SAME physical tray
    as any cell already placed on this plate (see _established_tray_id - a plate is one
    carousel box, which can only ever hold one tray), and - see the chronological-order check
    below - isn't displacing an already-started later use of the same cell.

    A grid slot is a plate LOADING position, not a cell, so there is no "must stay in its own
    well" check: the sample lands in the slot it was dropped onto (`well`), and which physical
    cell it runs on is what this resolves. `well` is the dropped plate position
    (WELLS[slot_index]) - used to open a fresh tray in mode "new". `load_date`/`plate_index`
    identify which Plate (Cycle) this placement is joining, purely to look up its already-
    established tray, if any - see _load_existing_cycle.

    A burned-barcode clash NEVER blocks resolution here - not even for an explicit "existing"
    choice (lab-owner decision 2026-08-07: warn, don't block, on every manual path). The clash
    is real and is surfaced afterward on the card (has_barcode_clash -> StageOut.barcode_clash),
    for the user to rectify - never as a refused request or a silent reroute (see
    docs/pacbio-sprq-nx-scheduling-reference.md's "Sequential wells take sequential cells")."""
    target_cycle = _load_existing_cycle(db, instrument_id=instrument_id, load_date=load_date, plate_index=plate_index)
    committed_tray_id = _established_tray_id(target_cycle)

    mode = cell_choice.get("mode")
    if mode == "existing":
        cell_id = cell_choice.get("cell_id")
        if cell_id is None:
            raise PlacementError(400, "cell_choice.cell_id is required when mode is 'existing'.")
        cell = db.get(
            Cell,
            cell_id,
            options=[
                selectinload(Cell.cell_uses).selectinload(CellUse.barcodes),
                selectinload(Cell.cell_uses).selectinload(CellUse.cycle).selectinload(Cycle.run_batch),
                selectinload(Cell.cell_uses).selectinload(CellUse.sample),
                selectinload(Cell.tray).selectinload(CellTray.instrument),
            ],
        )
        if cell is None:
            raise PlacementError(404, f"Cell {cell_id} not found.")
        if cell.status != "open":
            raise PlacementError(409, f"Cell {cell.code} is not open (status: {cell.status}).")
        _consumed, remaining, _burned = derive_cell_state(cell)
        if remaining <= 0:
            raise PlacementError(409, f"Cell {cell.code} has no remaining uses.")
        current_serial, _current_well = current_location(cell)
        if current_serial is not None and current_serial != instrument_serial:
            raise PlacementError(
                409,
                f"Cell {cell.code} is already in use on instrument {current_serial}; "
                f"cannot place it on {instrument_serial}.",
            )
        if committed_tray_id is not None and cell.tray_id != committed_tray_id:
            raise PlacementError(
                409,
                f"This plate is already loaded from tray T{committed_tray_id}; cell {cell.code} "
                "belongs to a different tray and can't be added to the same plate.",
            )
        # A cell's next use may already be scheduled for a later day than `acquire_date` (see
        # waitingCells.ts's pendingReuseStatus ghost, the "Scheduled" placeholder the grid
        # lets a sample be dropped onto ahead of that later use). Inserting this use only
        # bumps the later one to a higher Use N - it's never removed, and use numbering is
        # already derived live by acquire_date order (run_serializer._use_number) - so this is
        # only safe while that later use is still pure planning. Reuse must stay strictly
        # sequential once a use has actually started in the lab (see
        # docs/pacbio-sprq-nx-scheduling-reference.md #4), so any other use already running
        # blocks an earlier insert ahead of it, regardless of which use that is.
        for other in cell.cell_uses:
            if other.status == "cancelled":
                continue
            other_date = use_run_date(other)
            if other_date is None or other_date <= acquire_date:
                continue
            if run_has_started(other):
                raise PlacementError(
                    409,
                    f"Cell {cell.code} already has a use on {other_date.isoformat()} that has "
                    f"started; cannot insert an earlier use ahead of it.",
                )
        return cell
    elif mode == "new":
        # Only guard tray cohesion when the target WELL is actually free - a same-well retry
        # is a plain slot collision, reported below (via the (cycle_id, well) unique
        # constraint at the caller's insert) with its own, more specific message.
        well_taken = target_cycle is not None and any(
            cu.status != "cancelled" and cu.well == well for cu in target_cycle.cell_uses
        )
        if committed_tray_id is not None and not well_taken:
            raise PlacementError(
                409,
                f"This plate is already loaded from tray T{committed_tray_id}; opening a "
                "brand-new tray here would split it across two physical trays.",
            )
        try:
            # founding_date lets open_new_tray treat an expired resident tray as physically
            # removed, so a reassignment onto a date the old tray has aged out mints a fresh
            # successor rather than 409ing (see open_new_tray / _cell_resident_on). Use the
            # fresh tray's NEXT-AVAILABLE cell (tray position 1), not the drop well's
            # position-matched one - "the well takes the next available cell regardless of plate
            # position" (see _resequence_plate); the plate is then laid out ascending.
            return _fresh_tray_cell(open_new_tray(db, instrument_id, well, founding_date=acquire_date))
        except ValueError as exc:
            raise PlacementError(409, str(exc)) from exc
    else:
        raise PlacementError(400, f"Unknown cell_choice.mode '{mode}'.")


def _reuse_window_open(
    cell: Cell, acquire_date: date, run_time_hours: float, start_hour: int, start_minute: int
) -> bool:
    """Whether `cell`'s 108h reuse window is still open for a use acquiring on `acquire_date`.
    load_prior_cells / the batch engine deliberately DON'T window-filter (there the window is
    advisory, flagged after the fact), so the auto-deriver must check it itself or it would
    silently auto-create an out-of-window reuse. Anchored on the real first-use start once
    confirmed (`first_use_started_at`), else the planned first-use start - mirrors the
    frontend's reuseWindow (waitingCells.ts). The deadline math is shared with the read-side
    reuse_window_exceeded flag via cell_service.reuse_deadline, so the gate and the flag agree."""
    deadline = reuse_deadline(cell)
    if deadline is None:
        return True  # never used yet - no 108h clock running (not a reuse candidate in practice)
    reuse_start, _ = planned_window(acquire_date, run_time_hours, start_hour, start_minute)
    return reuse_start <= deadline


def _reuse_eligible(
    db: Session,
    cell: Cell,
    *,
    instrument_serial: str,
    acquire_date: date,
    run_time_hours: float,
    start_hour: int,
    start_minute: int,
) -> bool:
    """Bool predicate for the auto-deriver, mirroring _resolve_cell_choice's "existing cell"
    guards (open, capacity left, same instrument, not inserting ahead of an already-started
    later use) PLUS the 108h window check. Well/position pinning is enforced by how candidates
    are gathered in derive_best_cell, so it isn't re-checked here.

    Deliberately NOT barcode-aware. A tray breaks its cells out in a fixed physical order, so
    the cell a manually-dropped sample lands on must be whichever the instrument would actually
    reach for next - never skipped for a barcode clash, which would silently transpose two
    cells and produce an impossible plate order (see docs/pacbio-sprq-nx-scheduling-
    reference.md's "sequential wells take sequential cells" rule). A resulting clash is
    real - it isn't avoided here - and surfaces afterward as StageOut.barcode_clash (see
    cell_service.has_barcode_clash), never as a silent reroute or a blocked drop. This is
    unlike _resolve_cell_choice's *explicit* "use this exact cell" mode, which still hard-
    blocks a clash outright: there the caller has full freedom to pick a different cell, so
    there's no ordering constraint forcing the clash in the first place."""
    if cell.status != "open":
        return False
    _consumed, remaining, _burned = derive_cell_state(cell)
    if remaining <= 0:
        return False
    serial, _well = current_location(cell)
    if serial is not None and serial != instrument_serial:
        return False
    for other in cell.cell_uses:
        if other.status == "cancelled":
            continue
        other_date = use_run_date(other)
        if other_date is None or other_date <= acquire_date:
            continue
        if run_has_started(other):
            return False
    return _reuse_window_open(cell, acquire_date, run_time_hours, start_hour, start_minute)


def _pick_next_reuse_cell(
    db: Session,
    cells: list[Cell],
    *,
    instrument: Instrument,
    load_date: date,
    slot_index: int,
    run_time_hours: float,
    start_hour: int,
    start_minute: int,
) -> Cell | None:
    """From candidate cells physically resident at a drop's instrument+carousel position,
    return the one the instrument reaches for next: reuse-before-new, the *most-used* open cell
    first (its 108h clock is nearest expiry, so it's finished before a fresh sibling is broken
    out), then unused siblings in tray order - the first that passes every reuse guard
    (_reuse_eligible: capacity, 108h window, instrument pin, no out-of-order insert) for this
    drop. None if no candidate is eligible. A barcode clash is never a reason to pass over a
    candidate here - see _reuse_eligible.

    This is the ICS "prioritise the cell expiring next / next in order" behaviour: the plate
    slot the sample is dropped onto is only a loading position - which physical cell runs it is
    picked here, and shown afterwards by the loaded card's stub (see run_serializer/StageOut).
    The plate's wells are then re-zipped onto its cells in this same priority order by
    _resequence_plate, so the loaded plate always reads ascending."""
    for cell in sorted(cells, key=_reuse_priority_key):
        _plate, acquire = _plate_target(
            db, cell=cell, instrument_id=instrument.id, load_date=load_date, slot_index=slot_index
        )
        if _reuse_eligible(
            db,
            cell,
            instrument_serial=instrument.serial_number,
            acquire_date=acquire,
            run_time_hours=run_time_hours,
            start_hour=start_hour,
            start_minute=start_minute,
        ):
            return cell
    return None


def derive_best_cell(
    db: Session,
    *,
    instrument: Instrument,
    load_date: date,
    slot_index: int,
    run_time_hours: float,
    start_hour: int = DAY_START_HOUR,
    start_minute: int = 0,
) -> dict:
    """Pick the physical cell a manually-dropped sample should use, mirroring the instrument's
    own allocation: a grid slot is a plate LOADING position, not a cell, so a drop reaches for
    the next-usable cell in that slot's physical tray (carousel position) - reuse-before-new,
    the cell nearest its 108h expiry first (see _pick_next_reuse_cell) - and only opens a fresh
    tray when none has capacity left. Returns a cell_choice dict
    (``{"mode":"existing","cell_id":N}`` or ``{"mode":"new"}``) understood by place_sample /
    move_sample, so an auto placement flows through the exact same persistence path as an
    explicit choice, just with the cell decided server-side.

    The card renders in the slot it was dropped onto regardless of which cell wins (CellUse.well
    stores the plate position); the chosen cell's identity is shown on the card's stub. Two
    reuse shapes, tried in order:
      1. **Intra-run Plate-2 reuse** - a drop onto a Plate-2 slot of a run that already loaded
         a Plate 1 reruns that same tray's cells as a sequential Plate 2 (Use 2+), acquiring a
         later weekday. The next-in-order Plate-1 cell wins, not a position-aligned one.
      2. **Cross-run reuse** - the next-in-order open cell physically resident in this slot's
         carousel position on this instrument (any of its 4 tray positions).
    Otherwise a brand-new tray. Eligibility (_reuse_eligible) includes the 108h window, so an
    out-of-window cell is never auto-reused - it falls through to a fresh tray instead. It does
    NOT include a barcode check: a tray breaks its cells out in a fixed physical order, so this
    always picks whichever cell the instrument would actually reach for, never a different one
    to dodge a barcode clash (see _reuse_eligible / docs/pacbio-sprq-nx-scheduling-reference.md's
    "sequential wells take sequential cells" rule). A resulting clash surfaces afterward as
    StageOut.barcode_clash, not as a rerouted or blocked placement.

    The moved sample re-adopting its own cell at a new well is no longer a hazard to guard
    against here (move_sample used to pass an `exclude_cell_id` for that): _resequence_plate now
    lays the destination plate's wells onto its cells in ascending order after the move, so a
    re-adopted cell simply takes whichever well its rank maps to - never a stranded transposition.

    (0) **Tray cohesion** - tried first, for both Plate 1 and Plate 2 slots: a Plate is
    physically one carousel box, which can only ever hold one physical tray, so once this
    plate already holds >=1 cell, every further well it gains must come from that SAME tray
    (see _established_tray_id). No global/cross-run reuse and no fresh tray are even
    considered in that case - if none of that tray's remaining open cells can take this
    sample, the placement is refused outright rather than silently substituting a foreign
    tray (the exact bug this guards against - see docs/pacbio-sprq-nx-scheduling-
    reference.md)."""
    plate_index = 1 if slot_index < PLATE_SIZE else 2
    target_cycle = _load_existing_cycle(db, instrument_id=instrument.id, load_date=load_date, plate_index=plate_index)
    committed_tray_id = _established_tray_id(target_cycle)

    if committed_tray_id is not None:
        already_in_cycle = {cu.cell_id for cu in target_cycle.cell_uses if cu.status != "cancelled"}
        tray_cells = db.scalars(select(Cell).where(Cell.tray_id == committed_tray_id, Cell.status == "open")).all()
        cands = [c for c in tray_cells if c.id not in already_in_cycle]
        best = _pick_next_reuse_cell(
            db, cands, instrument=instrument, load_date=load_date, slot_index=slot_index,
            run_time_hours=run_time_hours, start_hour=start_hour, start_minute=start_minute,
        )
        if best is not None:
            return {"mode": "existing", "cell_id": best.id}
        raise PlacementError(
            409,
            f"Can't place here: this plate is already loaded from tray T{committed_tray_id} and "
            "none of its remaining cells can take this sample (capacity, or its 108h reuse "
            "window). Try a different slot/day, or free a cell on that tray first.",
        )

    # (1) Intra-run Plate-2 reuse: rerun THIS run's Plate-1 cells as a sequential Plate 2.
    if slot_index >= PLATE_SIZE:
        plate1 = _load_existing_cycle(db, instrument_id=instrument.id, load_date=load_date, plate_index=1)
        if plate1 is not None:
            cands = [
                cu.cell
                for cu in plate1.cell_uses
                if cu.status != "cancelled"
                and cu.cell is not None
                and cu.cell.status == "open"
            ]
            best = _pick_next_reuse_cell(
                db, cands, instrument=instrument, load_date=load_date, slot_index=slot_index,
                run_time_hours=run_time_hours, start_hour=start_hour, start_minute=start_minute,
            )
            if best is not None:
                return {"mode": "existing", "cell_id": best.id}

    # (2) Cross-run reuse: the next-in-order open cell resident on this instrument, from EITHER
    # cell tray. A cell is pinned to its tray position, not to a plate box, so a Plate-1 drop may
    # reuse a cell whose home well is in the Plate-2 box (loaded into the Plate-1 display well) -
    # reuse-before-new across both trays, matching the auto-fill engine (see docs/pacbio-sprq-nx-
    # scheduling-reference.md's "Plate vs cell"). One-tray-per-plate cohesion is still enforced by
    # branch (0) / _established_tray_id once this plate's first cell lands - box-independently.
    prior, by_id = load_prior_cells(db, [])
    cands = []
    for pc in prior:
        if pc.pinned_instrument_serial != instrument.serial_number:
            continue
        cell = by_id[pc.cell_id]
        if _cell_used_in_run(cell, instrument.id, load_date):
            continue  # already covered by the intra-run branch above
        cands.append(cell)
    best = _pick_next_reuse_cell(
        db, cands, instrument=instrument, load_date=load_date, slot_index=slot_index,
        run_time_hours=run_time_hours, start_hour=start_hour, start_minute=start_minute,
    )
    if best is not None:
        return {"mode": "existing", "cell_id": best.id}

    # (3) No eligible reuse in this carousel position - open a new tray.
    return {"mode": "new"}


def place_sample(
    db: Session,
    *,
    sample_id: int,
    instrument_serial: str,
    load_date: date,
    slot_index: int,
    cell_choice: dict | None = None,
    run_time_hours: float | None = None,
    start_hour: int = DAY_START_HOUR,
    start_minute: int = 0,
    actor: str | None = None,
) -> RunBatch:
    # --- read-only validation (before any writes) ---
    if load_date.weekday() >= 5:
        raise PlacementError(400, f"{load_date.isoformat()} is a weekend - runs are weekdays only.")

    if not 0 <= slot_index < len(WELLS):
        raise PlacementError(400, f"slot_index must be 0-{len(WELLS) - 1}.")

    sample = db.get(Sample, sample_id, options=[selectinload(Sample.barcodes)])
    if sample is None:
        raise PlacementError(404, f"Sample {sample_id} not found.")
    if sample.status != "backlog":
        raise PlacementError(400, f"Only backlog samples can be placed (current status: {sample.status}).")

    instrument = db.scalar(select(Instrument).where(Instrument.serial_number == instrument_serial))
    if instrument is None:
        raise PlacementError(400, f"Unknown instrument serial '{instrument_serial}'.")

    sample_barcodes = sample.barcode_list

    # A plain drag-drop omits run_time_hours so the sample runs for its own imported/edited
    # movie time (Sample.movie_time_hours, default 24h - see engine.constants). An explicit
    # value (a re-place that carries an existing per-cell run time) still wins.
    if run_time_hours is None:
        run_time_hours = sample.movie_time_hours or DEFAULT_MOVIE_HOURS

    # No explicit cell choice (or an explicit "auto") -> the engine derives the cell, applying
    # the same reuse-before-new rule as auto-fill (see derive_best_cell). This is the default
    # for a plain drag-drop; an explicit {"new"|"existing"} still overrides it (the stub's
    # "use a different cell" path).
    if cell_choice is None or cell_choice.get("mode") == "auto":
        cell_choice = derive_best_cell(
            db,
            instrument=instrument,
            load_date=load_date,
            slot_index=slot_index,
            run_time_hours=run_time_hours,
            start_hour=start_hour,
            start_minute=start_minute,
        )
    mode = cell_choice.get("mode")

    # The sample always lands in the plate slot it was dropped onto (well = WELLS[slot_index]),
    # a loading position - not the cell's own identity well. Which physical cell runs it is what
    # differs by mode: a fresh cell opens a new tray at this position; an existing cell is the
    # one the instrument reaches for, and if it's already loaded in this run it becomes the
    # sequential reuse Plate 2 (a later acquire day, via _plate_target).
    well = WELLS[slot_index]
    existing_cell: Cell | None = None
    if mode == "existing":
        cell_id = cell_choice.get("cell_id")
        if cell_id is None:
            raise PlacementError(400, "cell_choice.cell_id is required when mode is 'existing'.")
        prelim = db.get(Cell, cell_id, options=[selectinload(Cell.cell_uses).selectinload(CellUse.cycle).selectinload(Cycle.run_batch)])
        plate_index, acquire_date = _plate_target(
            db, cell=prelim, instrument_id=instrument.id, load_date=load_date, slot_index=slot_index
        )
        existing_cell = _resolve_cell_choice(
            db,
            cell_choice,
            instrument_id=instrument.id,
            instrument_serial=instrument_serial,
            well=well,
            acquire_date=acquire_date,
            load_date=load_date,
            plate_index=plate_index,
        )
    elif mode == "new":
        plate_index, acquire_date = _plate_target(
            db, cell=None, instrument_id=instrument.id, load_date=load_date, slot_index=slot_index
        )
    else:
        raise PlacementError(400, f"Unknown cell_choice.mode '{mode}'.")

    # --- writes ---
    cycle = get_or_create_run(
        db,
        instrument=instrument,
        load_date=load_date,
        plate_index=plate_index,
        acquire_date=acquire_date,
        run_time_hours=run_time_hours,
        start_hour=start_hour,
        start_minute=start_minute,
    )
    if cycle.status != "planned":
        raise PlacementError(409, f"Run is locked (status: {cycle.status}); cannot place into it.")

    if mode == "new":
        # Only guard tray cohesion when the target WELL is actually free - a same-well retry
        # (this exact well already taken) is a plain slot collision, reported below via the
        # (cycle_id, well) unique constraint with its own, more specific message; that
        # pre-existing check must still win here, not get preempted by this newer one.
        well_taken = any(cu.status != "cancelled" and cu.well == well for cu in cycle.cell_uses)
        committed_tray_id = _established_tray_id(cycle)
        if committed_tray_id is not None and not well_taken:
            raise PlacementError(
                409,
                f"Can't open a new tray here: this plate is already loaded from tray "
                f"T{committed_tray_id}.",
            )
        try:
            # acquire_date lets an expired resident tray be treated as physically removed, so a
            # plain drop onto a date it has aged out mints a fresh successor tray in its
            # carousel position instead of 409ing (see open_new_tray / _cell_resident_on). Use
            # the fresh tray's NEXT-AVAILABLE cell (tray position 1), not the drop well's
            # position-matched one - see _fresh_tray_cell / _resequence_plate.
            cell = _fresh_tray_cell(open_new_tray(db, instrument.id, well, founding_date=acquire_date))
        except ValueError as exc:
            raise PlacementError(409, str(exc)) from exc
    else:
        cell = existing_cell

    cell_use = CellUse(
        cycle_id=cycle.id,
        cell_id=cell.id,
        sample_id=sample.id,
        well=well,
        run_time_hours=int(run_time_hours),
        status="planned",
    )
    db.add(cell_use)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise PlacementError(409, f"slot already occupied: well {well} is taken on this plate.")

    for bc in sample_barcodes:
        db.add(CellUseBarcode(cell_use_id=cell_use.id, barcode=bc))

    sample.status = "scheduled"
    # Clear any Cell-QC "recoverable"/"repeatable" tag once the sample is scheduled again, so a
    # requeued-then-rescheduled sample doesn't linger in the Backlog's "Recoverable Samples"
    # section if it ever returns to the backlog by another path. See services/qc_service.py.
    sample.qc_disposition = None

    # Lay this plate's wells onto its cells in ascending order (see _resequence_plate) so the
    # freshly-placed sample never leaves the plate reading an out-of-order cell number.
    _resequence_plate(db, cycle)
    recompute_cycle_timing(db, cycle)
    db.refresh(cell, attribute_names=["cell_uses"])
    recompute_status(cell, utcnow())

    run_batch_id = cycle.run_batch_id
    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="place_sample",
            entity_type="cell_use",
            entity_id=cell_use.id,
            details_json={
                "sample_id": sample.id,
                "cell_id": cell.id,
                "cycle_id": cycle.id,
                "plate_index": plate_index,
                "well": well,
                "instrument_serial": instrument_serial,
                "load_date": load_date.isoformat(),
                # cycle.acquire_date, not the caller-local acquire_date: get_or_create_run
                # recomputes a reuse Plate 2's day from Plate 1's real timing (see
                # reuse_plate_window), so the local is stale for a reuse.
                "acquire_date": cycle.acquire_date.isoformat(),
            },
        )
    )
    db.commit()
    return db.get(RunBatch, run_batch_id)


def _remove_one(db: Session, cell_use_id: int, actor: str | None = None) -> None:
    """Delete one planned placement, return its sample to the backlog, and clean up any
    now-empty plate/run and released cell - WITHOUT committing. Shared by the single-item
    `remove_sample` and the atomic bulk `remove_samples`. Every failure path (missing,
    not-planned, cancelled marker) raises before any write, so a bulk caller can skip a bad
    id and keep the rest of its one transaction intact."""
    cell_use = db.get(
        CellUse,
        cell_use_id,
        options=[
            selectinload(CellUse.cycle).selectinload(Cycle.run_batch),
            selectinload(CellUse.cell),
            selectinload(CellUse.sample),
        ],
    )
    if cell_use is None:
        raise PlacementError(404, f"Cell use {cell_use_id} not found.")

    cycle = cell_use.cycle
    if cycle is None or cycle.status != "planned":
        raise PlacementError(409, "Cannot remove a placement from a run that is not planned.")
    if cell_use.status == "cancelled":
        raise PlacementError(409, "This placement was cancelled when its cell was stopped and can't be modified.")

    cell = cell_use.cell
    cycle_id = cycle.id

    # Lock the cycle row so concurrent removals of sibling stages on the same plate serialize
    # here instead of racing on the "any stages left?" count. No-op on SQLite (dev), which
    # doesn't support FOR UPDATE - which is exactly why the bulk clear now runs every removal
    # in ONE transaction (remove_samples) rather than one concurrent DELETE per stage: a race
    # here used to leave an orphaned empty cycle behind that then projected a stale instrument
    # lock (see remove_samples and run_serializer.run_out).
    db.execute(select(Cycle.id).where(Cycle.id == cycle_id).with_for_update())

    if cell_use.sample is not None:
        cell_use.sample.status = "backlog"

    db.delete(cell_use)
    db.flush()

    plate_deleted, _run_deleted = _cleanup_emptied_plate(db, cycle)
    if not plate_deleted:
        # The plate lost a well; re-zip its remaining wells onto its cells so it still reads
        # ascending (see _resequence_plate).
        _resequence_plate(db, cycle)

    if cell is not None:
        _release_cell(db, cell, utcnow())

    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="remove_sample",
            entity_type="cell_use",
            entity_id=cell_use_id,
            details_json={"cycle_id": cycle_id, "plate_deleted": plate_deleted},
        )
    )


def remove_sample(db: Session, cell_use_id: int, actor: str | None = None) -> None:
    _remove_one(db, cell_use_id, actor)
    db.commit()


def remove_samples(
    db: Session, cell_use_ids: list[int], actor: str | None = None
) -> tuple[list[int], list[tuple[int, str]]]:
    """Atomically remove many planned placements in ONE transaction - the bulk "Clear
    schedule" and multi-select "Remove from schedule" actions. Because every delete + cleanup
    runs sequentially in a single transaction, _cleanup_emptied_plate always sees a consistent
    stage count, so an emptied plate/run is always fully deleted - unlike the previous
    one-concurrent-DELETE-per-stage path, which could race that count check and strand an
    orphaned empty cycle (a stale instrument lock, reported by the lab owner). A use that
    can't be removed (missing / not planned / a cancelled Stop marker) is skipped with its
    reason instead of aborting the batch. Returns (removed_ids, [(id, reason), ...])."""
    removed: list[int] = []
    failures: list[tuple[int, str]] = []
    for cid in cell_use_ids:
        try:
            _remove_one(db, cid, actor)
            removed.append(cid)
        except PlacementError as exc:
            failures.append((cid, exc.detail))
    db.commit()
    return removed, failures


def return_cancelled_use_to_backlog(db: Session, cell_use_id: int, actor: str | None = None) -> int | None:
    """Recover a placement left stuck as a cancelled ("Blocked") slot by a cell *discard*:
    delete the dead CellUse row so it stops rendering in the weekly grid, and make sure its
    sample is back in the backlog. Returns the reverted sample id (None if the use carried
    no sample).

    Only discard-originated cancellations qualify. A cancellation from a QC Stop (see
    cell_service.stop_cell) is a deliberate, permanent marker of a dead well - refused here
    (409) so the QC trail stays intact; that one is reversed with Undo stop instead. The two
    are told apart by cell.discarded_at, which only a discard ever sets. Plate/run cleanup
    mirrors remove_sample."""
    cell_use = db.get(
        CellUse,
        cell_use_id,
        options=[
            selectinload(CellUse.cycle).selectinload(Cycle.run_batch),
            selectinload(CellUse.cell),
            selectinload(CellUse.sample),
        ],
    )
    if cell_use is None:
        raise PlacementError(404, f"Cell use {cell_use_id} not found.")
    if cell_use.status != "cancelled":
        raise PlacementError(409, "Only a cancelled (Blocked) placement can be returned to the backlog this way.")

    cell = cell_use.cell
    if cell is None or cell.discarded_at is None:
        raise PlacementError(
            409,
            "This Blocked slot was created by a Stop cell action, not a discard, so it's kept as a "
            "permanent record. Use Undo stop on the cell instead.",
        )

    cycle = cell_use.cycle
    sample = cell_use.sample
    sample_id = cell_use.sample_id

    if cycle is not None:
        # Serialize concurrent recoveries of sibling blocked stages on the same plate, the
        # same way remove_sample guards its own count - no-op on SQLite (dev).
        db.execute(select(Cycle.id).where(Cycle.id == cycle.id).with_for_update())

    db.delete(cell_use)  # cascades this use's own barcodes
    db.flush()

    # The discard already bounced the sample to the backlog, but it may have been
    # rescheduled since - only force it back if it has no other live (non-cancelled)
    # placement, so a sample that's legitimately scheduled elsewhere isn't clobbered.
    if sample is not None:
        active = db.scalar(
            select(func.count())
            .select_from(CellUse)
            .where(CellUse.sample_id == sample.id, CellUse.status != "cancelled")
        )
        if active == 0 and sample.status != "backlog":
            sample.status = "backlog"

    if cycle is not None:
        _cleanup_emptied_plate(db, cycle)

    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="return_cancelled_use_to_backlog",
            entity_type="cell_use",
            entity_id=cell_use_id,
            details_json={"sample_id": sample_id, "cycle_id": cycle.id if cycle else None},
        )
    )
    db.commit()
    return sample_id


def move_sample(
    db: Session,
    *,
    cell_use_id: int,
    instrument_serial: str,
    load_date: date,
    slot_index: int,
    run_time_hours: float,
    start_hour: int = DAY_START_HOUR,
    start_minute: int = 0,
    cell_choice: dict | None = None,
    actor: str | None = None,
) -> RunBatch:
    """Move an existing placement to a different (instrument, load_date, slot).

    A grid slot is a plate LOADING position, not a cell. Moving a sample to the *same* loading
    well on a different day is a plain reschedule: the same physical cell keeps its slot, an
    in-place update of the CellUse's cycle/well - never a delete+recreate. That avoids two
    problems a client-side remove-then-place has: a rejected re-place leaving the sample
    stranded in backlog with the old slot already gone, and the old cell being deleted (as an
    emptied placeholder) out from under a move meant to keep it.

    Moving to a *different* loading well - a different slot in the same tray, a different
    carousel position, or a different instrument - hands the sample to the cell the instrument
    would reach for at the destination (reuse-before-new, resolved via `cell_choice` /
    derive_best_cell), exactly like a fresh placement. A physical cell is fixed to its own
    tray/well position for life, so a moved sample can never drag its current cell into a
    foreign well; and because a fresh cell is always the earliest in tray order, slot A01 keeps
    showing cell A while cell A has capacity, never a later cell (see the "Plate vs cell"
    refinement in docs/pacbio-sprq-nx-scheduling-reference.md). See _move_sample_to_new_cell
    for that path's own atomicity guarantees."""
    # --- read-only validation (before any writes) ---
    if load_date.weekday() >= 5:
        raise PlacementError(400, f"{load_date.isoformat()} is a weekend - runs are weekdays only.")
    if not 0 <= slot_index < len(WELLS):
        raise PlacementError(400, f"slot_index must be 0-{len(WELLS) - 1}.")

    cell_use = db.get(
        CellUse,
        cell_use_id,
        options=[
            selectinload(CellUse.cycle).selectinload(Cycle.run_batch),
            selectinload(CellUse.barcodes),
            selectinload(CellUse.sample),
            selectinload(CellUse.cell).selectinload(Cell.cell_uses).selectinload(CellUse.cycle).selectinload(
                Cycle.run_batch
            ).selectinload(RunBatch.instrument),
            selectinload(CellUse.cell).selectinload(Cell.cell_uses).selectinload(CellUse.sample),
        ],
    )
    if cell_use is None:
        raise PlacementError(404, f"Cell use {cell_use_id} not found.")

    old_cycle = cell_use.cycle
    if old_cycle is None or old_cycle.status != "planned":
        raise PlacementError(409, "Cannot move a placement from a run that is not planned.")
    if cell_use.status == "cancelled":
        raise PlacementError(409, "This placement was cancelled when its cell was stopped and can't be modified.")

    # A move preserves this well's own run time - the client sends the current Run Design
    # dial value, but that dial only sets run time for *new* placements; rescheduling an
    # existing placement (or reassigning it to a fresh cell) keeps whatever run time it was
    # given, editable only via the slot-detail popover. Ignore the passed value.
    run_time_hours = cell_use.run_time_hours

    instrument = db.scalar(select(Instrument).where(Instrument.serial_number == instrument_serial))
    if instrument is None:
        raise PlacementError(400, f"Unknown instrument serial '{instrument_serial}'.")

    cell = cell_use.cell
    other_uses = [cu for cu in cell.cell_uses if cu.id != cell_use.id and cu.status != "cancelled"]

    # The plate loading position the sample is dropped onto - a slot, not the cell's identity.
    dest_well = WELLS[slot_index]

    # A cell's pinned instrument comes from whichever of its uses is authoritative for
    # "where this physical cell currently is": its other real uses if it has any, or - for a
    # cell with no other uses yet - this very use's own (old) run batch.
    if other_uses:
        last_other = max(other_uses, key=use_sort_key)
        pinned_run_batch = last_other.cycle.run_batch if last_other.cycle else None
    else:
        pinned_run_batch = old_cycle.run_batch
    pinned_serial = pinned_run_batch.instrument.serial_number if pinned_run_batch and pinned_run_batch.instrument else None

    # The plate (Cycle) the destination slot lands in - for the moved cell, so an intra-run
    # reuse reads as the sequential Plate 2 (excluding this very use so a plain reschedule of it
    # doesn't count as a reuse of itself).
    dest_plate_index, dest_acquire_date = _plate_target(
        db, cell=cell, instrument_id=instrument.id, load_date=load_date, slot_index=slot_index, exclude_use_id=cell_use.id
    )
    old_rb = old_cycle.run_batch
    # An explicit override (the CellInfoPopover "use a new cell" / "choose a specific cell"
    # actions) - naming the same cell it's already on is not an override.
    explicit_override = cell_choice is not None and (
        cell_choice.get("mode") == "new" or cell_choice.get("cell_id") != cell.id
    )
    same_plate = (
        old_rb is not None
        and old_rb.instrument_id == instrument.id
        and old_rb.load_date == load_date
        and dest_plate_index == old_cycle.plate_index
    )

    # A within-plate reorder (same instrument, day and plate; no explicit cell override): keep
    # every cell where it is and just move this sample's loading well, then _resequence_plate
    # re-zips the plate's wells onto its cells in ascending order. This is what makes "drop A,
    # then C, then B" settle to A=1, B=2, C=3 without churning any other sample onto a fresh
    # cell (the old delete-and-recreate path did). A grid slot is a plate LOADING position, not
    # a cell - see docs/pacbio-sprq-nx-scheduling-reference.md's "Sequential wells take
    # sequential cells".
    if same_plate and not explicit_override:
        if cell_use.well == dest_well:
            return old_rb  # no-op: dropped back onto its own slot
        cell_use.well = dest_well
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            raise PlacementError(409, f"slot already occupied: well {dest_well} is taken on this plate.")
        _resequence_plate(db, old_cycle)
        recompute_cycle_timing(db, old_cycle)
        db.add(
            AuditLog(
                actor=actor or "unknown",
                action="move_sample",
                entity_type="cell_use",
                entity_id=cell_use.id,
                details_json={
                    "from_cycle_id": old_cycle.id,
                    "to_cycle_id": old_cycle.id,
                    "well": dest_well,
                    "instrument_serial": instrument_serial,
                    "load_date": load_date.isoformat(),
                },
            )
        )
        db.commit()
        return db.get(RunBatch, old_rb.id)

    # A cross-plate / cross-day / cross-instrument move, or an explicit cell override, hands the
    # sample to the cell the instrument would reach for at the destination (reuse-before-new, via
    # derive_best_cell) - never dragging the sample's current physical cell into a foreign plate.
    # A cross-instrument move can never keep the physical cell (a cell never crosses instruments).
    reassign_to_new_cell = pinned_serial is not None and pinned_serial != instrument_serial
    if not reassign_to_new_cell and dest_well != cell_use.well:
        reassign_to_new_cell = True
    if not reassign_to_new_cell and explicit_override:
        reassign_to_new_cell = True

    if reassign_to_new_cell and cell_choice is None:
        # No explicit target cell - derive the next-in-order cell at the destination, same as a
        # fresh drop (reuse-before-new, see derive_best_cell), so a plain drag "just works". No
        # exclusion of the moved cell any more: _resequence_plate now enforces ascending well->
        # cell order on the destination plate, so re-adopting the same cell (a genuine reuse on a
        # later day) is safe and no longer produces the loading-well != home-well transposition
        # the old exclude_cell_id workaround guarded against.
        cell_choice = derive_best_cell(
            db,
            instrument=instrument,
            load_date=load_date,
            slot_index=slot_index,
            run_time_hours=run_time_hours,
            start_hour=start_hour,
            start_minute=start_minute,
        )

    if reassign_to_new_cell:
        return _move_sample_to_new_cell(
            db,
            cell_use=cell_use,
            old_cycle=old_cycle,
            instrument=instrument,
            load_date=load_date,
            slot_index=slot_index,
            run_time_hours=run_time_hours,
            start_hour=start_hour,
            start_minute=start_minute,
            cell_choice=cell_choice,
            actor=actor,
        )

    # --- writes: same-cell reschedule (a cross-day move onto the same loading well) ---
    # The cell keeps its own well; the plate/acquire day come from the slot.
    dest_cycle = get_or_create_run(
        db,
        instrument=instrument,
        load_date=load_date,
        plate_index=dest_plate_index,
        acquire_date=dest_acquire_date,
        run_time_hours=run_time_hours,
        start_hour=start_hour,
        start_minute=start_minute,
    )
    if dest_cycle.status != "planned":
        raise PlacementError(409, f"Run is locked (status: {dest_cycle.status}); cannot place into it.")

    old_cycle_id = old_cycle.id
    same_cycle = old_cycle_id == dest_cycle.id
    if same_cycle and cell_use.well == dest_well:
        return dest_cycle.run_batch  # no-op: dropped back onto its own slot

    cell_use.cycle = dest_cycle
    cell_use.well = dest_well
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise PlacementError(409, f"slot already occupied: well {dest_well} is taken on this plate.")

    dest_run_batch_id = dest_cycle.run_batch_id
    plate_deleted = False
    if not same_cycle:
        plate_deleted, _run_deleted = _cleanup_emptied_plate(db, old_cycle)
        if not plate_deleted:
            _resequence_plate(db, old_cycle)  # the plate this sample left may now read out of order

    # Destination gains this well (its representative run time may now be longer).
    _resequence_plate(db, dest_cycle)
    recompute_cycle_timing(db, dest_cycle)

    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="move_sample",
            entity_type="cell_use",
            entity_id=cell_use.id,
            details_json={
                "from_cycle_id": old_cycle_id,
                "to_cycle_id": dest_cycle.id,
                "well": dest_well,
                "instrument_serial": instrument_serial,
                "load_date": load_date.isoformat(),
            },
        )
    )
    db.commit()
    return db.get(RunBatch, dest_run_batch_id)


def _move_sample_to_new_cell(
    db: Session,
    *,
    cell_use: CellUse,
    old_cycle: Cycle,
    instrument: Instrument,
    load_date: date,
    slot_index: int,
    run_time_hours: float,
    start_hour: int,
    start_minute: int,
    cell_choice: dict | None,
    actor: str | None,
) -> RunBatch:
    """The dragged sample's physical cell can't reach the destination - a different instrument
    (a cell never crosses instruments), a different day/plate, or an explicit cell override - so
    hand the sample to `cell_choice`'s resolved cell instead. One transaction: a new CellUse
    under the resolved cell replaces this one, and the sample's status never bounces through
    "backlog" in between (unlike a naive remove-then-place). Both the plate the sample joins and
    the plate it leaves are re-sequenced afterward so each still reads ascending."""
    old_cell = cell_use.cell
    if cell_choice is None:
        raise PlacementError(
            400,
            f"cell_choice is required to move sample off cell {old_cell.code} to slot {slot_index}.",
        )

    barcodes = cell_use.barcode_list
    mode = cell_choice.get("mode")

    # The sample lands in the plate slot it was dropped onto (a loading position); which cell
    # runs it is what `cell_choice` resolves. Plate/acquire come from the slot, or - for an
    # existing cell already loaded in this run - the sequential reuse Plate 2 (via _plate_target).
    well = WELLS[slot_index]
    # exclude_use_id: the use being moved is about to be deleted and replaced, so it must not
    # count as an existing use of the chosen cell in this run - otherwise re-adopting the moved
    # sample's own cell (now allowed, since exclude_cell_id was removed) would misread as an
    # intra-run reuse Plate 2.
    if mode == "existing":
        cell_id = cell_choice.get("cell_id")
        if cell_id is None:
            raise PlacementError(400, "cell_choice.cell_id is required when mode is 'existing'.")
        prelim = db.get(Cell, cell_id, options=[selectinload(Cell.cell_uses).selectinload(CellUse.cycle).selectinload(Cycle.run_batch)])
        plate_index, acquire_date = _plate_target(
            db, cell=prelim, instrument_id=instrument.id, load_date=load_date, slot_index=slot_index, exclude_use_id=cell_use.id
        )
    else:
        plate_index, acquire_date = _plate_target(
            db, cell=None, instrument_id=instrument.id, load_date=load_date, slot_index=slot_index, exclude_use_id=cell_use.id
        )

    dest_cycle = get_or_create_run(
        db,
        instrument=instrument,
        load_date=load_date,
        plate_index=plate_index,
        acquire_date=acquire_date,
        run_time_hours=run_time_hours,
        start_hour=start_hour,
        start_minute=start_minute,
    )
    if dest_cycle.status != "planned":
        raise PlacementError(409, f"Run is locked (status: {dest_cycle.status}); cannot place into it.")

    new_cell = _resolve_cell_choice(
        db,
        cell_choice,
        instrument_id=instrument.id,
        instrument_serial=instrument.serial_number,
        well=well,
        acquire_date=acquire_date,
        load_date=load_date,
        plate_index=plate_index,
    )

    old_cycle_id = old_cycle.id
    dest_run_batch_id = dest_cycle.run_batch_id

    new_cell_use = CellUse(
        cycle_id=dest_cycle.id,
        cell_id=new_cell.id,
        sample_id=cell_use.sample_id,
        well=well,
        run_time_hours=int(run_time_hours),
        status="planned",
    )
    db.add(new_cell_use)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise PlacementError(409, f"slot already occupied: well {well} is taken on this plate.")

    for bc in barcodes:
        db.add(CellUseBarcode(cell_use_id=new_cell_use.id, barcode=bc))

    db.delete(cell_use)
    db.flush()

    if old_cycle_id != dest_cycle.id:
        plate_deleted, _run_deleted = _cleanup_emptied_plate(db, old_cycle)
        if not plate_deleted:
            _resequence_plate(db, old_cycle)  # the plate this sample left may now read out of order

    # Lay the destination plate's wells onto its cells in ascending order (see _resequence_plate).
    _resequence_plate(db, dest_cycle)
    recompute_cycle_timing(db, dest_cycle)

    now = utcnow()
    _release_cell(db, old_cell, now)
    db.refresh(new_cell, attribute_names=["cell_uses"])
    recompute_status(new_cell, now)

    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="move_sample",
            entity_type="cell_use",
            entity_id=new_cell_use.id,
            details_json={
                "from_cycle_id": old_cycle_id,
                "to_cycle_id": dest_cycle.id,
                "well": well,
                "instrument_serial": instrument.serial_number,
                "load_date": load_date.isoformat(),
                "from_cell_id": old_cell.id,
                "to_cell_id": new_cell.id,
            },
        )
    )
    db.commit()
    return db.get(RunBatch, dest_run_batch_id)


def swap_samples(db: Session, *, cell_use_id_a: int, cell_use_id_b: int, actor: str | None = None) -> list[RunBatch]:
    """Exchange which sample is loaded onto two already-placed CellUses - dragging a placed
    sample onto a *different* occupied slot in the weekly grid. Deliberately never touches
    cycle_id/well/cell_id on either row: only sample_id and its barcode snapshot move. So
    neither cell gains or loses a use, no use's acquire_date changes, and the well each cell
    is pinned to is untouched on both sides - the 3-use cap, 108h window, and the (cycle_id,
    well) unique constraint all stay structurally unaffected. Each side's cell was already an
    independently valid home for its OWN sample (whichever instrument that happens to be on) -
    a swap doesn't introduce a new cell choice for either sample, it only exchanges the two
    that already passed that check, so there's no instrument-match guard to add here (unlike
    _resolve_cell_choice's "existing cell" mode, which validates a *newly proposed* cell
    against the instrument being placed onto - see test_swap_cross_cell_cross_day_cross_
    instrument_exchanges_samples_only, which is deliberate, tested behaviour, not a gap).
    A resulting barcode clash never blocks the swap - it is surfaced afterward on the card
    (has_barcode_clash -> StageOut.barcode_clash) for the user to rectify, the same warn-don't-
    block rule every manual path now follows (lab-owner decision 2026-08-07). Returns the
    affected run(s)."""
    if cell_use_id_a == cell_use_id_b:
        raise PlacementError(400, "Cannot swap a placement with itself.")

    options = [
        selectinload(CellUse.cycle).selectinload(Cycle.run_batch),
        selectinload(CellUse.cell).selectinload(Cell.cell_uses).selectinload(CellUse.barcodes),
        selectinload(CellUse.cell).selectinload(Cell.cell_uses).selectinload(CellUse.sample),
        selectinload(CellUse.barcodes),
        selectinload(CellUse.sample),
    ]
    # Lock both rows before reading, in a fixed (ascending id) order regardless of which side
    # of the drag was "a" or "b" - two concurrent swaps touching the same pair from either
    # direction could otherwise both read the pre-swap state and race each other's write,
    # silently dropping one sample (a real lost-update, not just a theoretical one, under
    # Postgres READ COMMITTED in production). A consistent lock order also avoids a
    # cross-deadlock between two such requests. SQLite (dev) has no FOR UPDATE and silently
    # no-ops it, so this is free there and load-bearing only in production.
    locked = {
        cid: db.get(CellUse, cid, options=options, with_for_update=True)
        for cid in sorted((cell_use_id_a, cell_use_id_b))
    }
    use_a = locked[cell_use_id_a]
    use_b = locked[cell_use_id_b]
    if use_a is None:
        raise PlacementError(404, f"Cell use {cell_use_id_a} not found.")
    if use_b is None:
        raise PlacementError(404, f"Cell use {cell_use_id_b} not found.")

    for use in (use_a, use_b):
        if use.cycle is None or use.cycle.status != "planned":
            raise PlacementError(409, "Cannot swap a placement on a run that is not planned.")
        if use.status != "planned":
            raise PlacementError(409, f"Cell use {use.id} is not a re-plannable placement (status: {use.status}).")
        if use.sample_id is None:
            raise PlacementError(400, "Cannot swap a placement with no sample loaded.")

    sample_a_id, sample_b_id = use_a.sample_id, use_b.sample_id
    sample_a_barcodes, sample_b_barcodes = use_a.barcode_list, use_b.barcode_list

    # A barcode clash a swap would create is not blocked (warn, don't block): the exchange goes
    # through and any clash surfaces on the card. Two uses of the same physical cell can't
    # introduce a new clash anyway (they already share one burned-barcode set); a swap across
    # cells can, and that is left to the has_barcode_clash flag to report.
    use_a.sample_id, use_b.sample_id = sample_b_id, sample_a_id
    for row in list(use_a.barcodes) + list(use_b.barcodes):
        db.delete(row)
    db.flush()
    for bc in sample_b_barcodes:
        db.add(CellUseBarcode(cell_use_id=use_a.id, barcode=bc))
    for bc in sample_a_barcodes:
        db.add(CellUseBarcode(cell_use_id=use_b.id, barcode=bc))

    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="swap_samples",
            entity_type="cell_use",
            entity_id=use_a.id,
            details_json={
                "cell_use_id_a": use_a.id,
                "cell_use_id_b": use_b.id,
                "sample_id_a_before": sample_a_id,
                "sample_id_b_before": sample_b_id,
            },
        )
    )
    db.commit()
    rb_a = use_a.cycle.run_batch
    rb_b = use_b.cycle.run_batch
    return [rb_a] if rb_a.id == rb_b.id else [rb_a, rb_b]


def update_cell_use_run_time(
    db: Session, *, cell_use_id: int, run_time_hours: int, actor: str | None = None
) -> RunBatch:
    """Change one well's own movie / run time from the slot-detail popover, then re-derive
    the owning plate's representative movie_hours / planned end (see recompute_cycle_timing).

    Editable only while both the run and this use are still `planned`. Like the rest of this
    module's instrument-lock handling, this does NOT retroactively re-validate a *later* run
    on the same instrument against the (possibly longer) lock this extends - the lock is a
    forward-looking planning aid checked when a new run is created (see get_or_create_run).
    Returns the owning run for re-serialization."""
    cell_use = db.get(CellUse, cell_use_id, options=[selectinload(CellUse.cycle).selectinload(Cycle.run_batch)])
    if cell_use is None:
        raise PlacementError(404, f"Cell use {cell_use_id} not found.")

    cycle = cell_use.cycle
    if cycle is None or cycle.status != "planned":
        raise PlacementError(409, "Run time can only be changed on a run that is still planned.")
    if cell_use.status != "planned":
        raise PlacementError(409, "This placement isn't editable (it has started, run, or been cancelled).")

    old = cell_use.run_time_hours
    cell_use.run_time_hours = int(run_time_hours)
    db.flush()
    recompute_cycle_timing(db, cycle)

    run_batch_id = cycle.run_batch_id
    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="update_cell_use_run_time",
            entity_type="cell_use",
            entity_id=cell_use.id,
            details_json={"from": old, "to": int(run_time_hours), "cycle_id": cycle.id},
        )
    )
    db.commit()
    return db.get(RunBatch, run_batch_id)


def cancel_run(db: Session, run_id: int, actor: str | None = None) -> None:
    """Cancel a whole run (all its plates). run_id is the RunBatch id. Reverts each plate's
    still-live samples to the backlog and deletes the emptied plates and run; cancelled
    ("Blocked") markers from a Stop cell are kept, so if any plate holds one the run/plate is
    left in place around it (mirroring remove_sample)."""
    run_batch = db.get(
        RunBatch,
        run_id,
        options=[
            selectinload(RunBatch.cycles).selectinload(Cycle.cell_uses).selectinload(CellUse.sample),
            selectinload(RunBatch.cycles).selectinload(Cycle.cell_uses).selectinload(CellUse.cell),
        ],
    )
    if run_batch is None:
        raise PlacementError(404, f"Run {run_id} not found.")
    if any(c.status != "planned" for c in run_batch.cycles):
        raise PlacementError(409, "Only planned runs can be cancelled.")

    # Cancelled stages (a stopped cell's permanent marker - see stop_cell) are excluded from
    # what this cancels: they aren't a real, revertable placement, and deleting one would
    # discard the "kept forever" guarantee stop_cell's design intends.
    touched_cells: set[Cell] = set()
    reverted = 0
    any_marker_kept = any(cu.status == "cancelled" for c in run_batch.cycles for cu in c.cell_uses)

    # Revert every still-live sample to the backlog and note its cell first - no deletes yet.
    for cycle in run_batch.cycles:
        for cu in cycle.cell_uses:
            if cu.status != "cancelled" and cu.sample is not None:
                cu.sample.status = "backlog"
                reverted += 1
            if cu.cell is not None:
                touched_cells.add(cu.cell)

    if not any_marker_kept:
        # Nothing to preserve: one delete and the ORM cascade cleanly removes every plate,
        # cell_use and barcode under the run - no manual child deletes to double up on.
        db.delete(run_batch)
    else:
        # Keep any plate holding a Stop-cell marker (and thus the run). A plate with no marker
        # is removed whole (clean cascade over its uses); a marker plate keeps its marker and
        # loses only its live uses (each cascades its own barcodes).
        for cycle in list(run_batch.cycles):
            all_uses = list(cycle.cell_uses)
            live = [cu for cu in all_uses if cu.status != "cancelled"]
            if len(live) == len(all_uses):
                db.delete(cycle)
            else:
                for cu in live:
                    db.delete(cu)
    db.flush()

    now = utcnow()
    for cell in touched_cells:
        _release_cell(db, cell, now)

    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="cancel_run",
            entity_type="run_batch",
            entity_id=run_id,
            details_json={"reverted_sample_count": reverted, "run_deleted": not any_marker_kept},
        )
    )
    db.commit()
