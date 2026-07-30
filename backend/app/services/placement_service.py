"""Interactive placement: users drag one sample onto one (instrument, load_date, slot) grid
cell at a time. Each placement gets-or-creates the run - a RunBatch keyed (instrument,
load_date) - plus the specific plate (a Cycle, plate_index 1|2) the slot lands in, resolves
a fresh or reused SMRT-cell, and records the CellUse.

A run holds 1-2 plates (Run->Plate model). Plate 1 acquires on the load day; a fresh Plate 2
(a second tray) acquires the same day (parallel), while a Plate 2 that reuses Plate 1's cells
acquires the next weekday (sequential, after the on-board wash) - all loaded in one session.

Errors are raised as PlacementError(status_code, detail); the API layer maps them to
HTTPExceptions. Validation is done read-only before any DB writes so a rejected request
never leaves half-written rows in a shared session."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.engine.constants import (
    CELL_LIFETIME_H,
    DAY_START_HOUR,
    DEFAULT_MOVIE_HOURS,
    REUSE_PREP_H,
    WELLS,
    within_tray_pos,
)
from app.models.audit import AuditLog
from app.models.cell import Cell
from app.models.cell_tray import CellTray
from app.models.instrument import Instrument
from app.models.sample import Sample
from app.models.schedule import CellUse, CellUseBarcode, Cycle, RunBatch
from app.services import instrument_lock
from app.services.cell_service import (
    barcode_owners,
    cleanup_tray_if_fully_unused,
    current_location,
    derive_cell_state,
    first_use_planned_start_at,
    foreign_barcode_clash,
    open_new_tray,
    recompute_status,
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


def _next_weekday(d: date) -> date:
    """The next Mon-Fri strictly after `d` - where a reuse Plate 2 acquires (the instrument
    washes and re-runs the same cells the following working day; runs are weekday-only)."""
    nxt = d + timedelta(days=1)
    while nxt.weekday() >= 5:
        nxt += timedelta(days=1)
    return nxt


def planned_window(
    acquire_date: date, run_time_hours: float, start_hour: int = DAY_START_HOUR, start_minute: int = 0
) -> tuple[datetime, datetime]:
    start = datetime.combine(acquire_date, time(hour=start_hour, minute=start_minute), tzinfo=timezone.utc)
    return start, start + timedelta(hours=run_time_hours)


def reuse_plate_window(
    plate1_start: datetime, plate1_movie_hours: float, reuse_movie_hours: float
) -> tuple[date, datetime, datetime]:
    """Timing for a reuse Plate 2, chained from Plate 1's real window - so the reuse's day
    reflects the movie length, not a fixed 'next day'.

    The instrument runs Plate 1's movie, does the on-board reuse wash (REUSE_PREP_H), then
    starts Plate 2. A 24-30h movie loaded midday lands the reuse the following weekday; only a
    very long movie (>~36h) pushes it a further day. If the reuse would start on a weekend it
    rolls forward to the next weekday's start hour - runs are weekday-only, and the operator
    isn't there to load it over the weekend. Returns (acquire_date, planned_start, planned_end).
    See docs/pacbio-sprq-nx-scheduling-reference.md's "Instrument load-lock timing" section."""
    plate1_end = ensure_aware(plate1_start) + timedelta(hours=plate1_movie_hours)
    start = plate1_end + timedelta(hours=REUSE_PREP_H)
    if start.weekday() >= 5:
        rolled = start.date()
        while rolled.weekday() >= 5:
            rolled += timedelta(days=1)
        start = datetime.combine(rolled, time(hour=DAY_START_HOUR), tzinfo=timezone.utc)
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


def update_run_load_time(db: Session, run_batch: RunBatch, start_hour: int, start_minute: int = 0) -> None:
    """Amend a run's load time - the hour it loads and starts sequencing - re-deriving every
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
            # Reuse Plate 2: rerun Plate 1's cells after its movie finishes + on-board wash.
            acquire_date, start, end = reuse_plate_window(plate1.planned_start_at, plate1.movie_hours, plate.movie_hours)
            plate.acquire_date = acquire_date
            plate.planned_start_at = start
            plate.planned_end_at = end
        else:
            # Same-day parallel Plate 2 (a second tray): loaded in the same session as Plate 1.
            plate.planned_start_at = new_start
            recompute_cycle_timing(db, plate)


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
        return 2, _next_weekday(load_date)
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
    barcodes: list[str],
    acquire_date: date,
    load_date: date,
    plate_index: int,
    external_id: str | None = None,
) -> Cell:
    """Shared "which cell hosts this sample" resolution, shared by place_sample and
    move_sample's cell-reassignment path: mode "new" opens a fresh tray at plate position
    `well`; mode "existing" validates the chosen cell is open, has capacity, has no
    burned-barcode clash with these barcodes, is on this same instrument (a physical cell
    never crosses instruments), belongs to the SAME physical tray as any cell already placed
    on this plate (see _established_tray_id - a plate is one carousel box, which can only
    ever hold one tray), and - see the chronological-order check below - isn't displacing an
    already-started later use of the same cell.

    A grid slot is a plate LOADING position, not a cell, so there is no "must stay in its own
    well" check any more: the sample lands in the slot it was dropped onto (`well`), and which
    physical cell it runs on is what this resolves. `well` is the dropped plate position
    (WELLS[slot_index]) - used to open a fresh tray in mode "new". `load_date`/`plate_index`
    identify which Plate (Cycle) this placement is joining, purely to look up its already-
    established tray, if any - see _load_existing_cycle.

    `external_id` (the sample's Container ID) lets the barcode-clash check exempt a cell this
    exact Container ID already burned this same barcode onto - another copy of a duplicate
    sample - from the clash it would otherwise raise for a genuinely different, foreign
    sample sharing that barcode (see cell_service.foreign_barcode_clash)."""
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
        if foreign_barcode_clash(barcode_owners(cell), external_id, barcodes):
            raise PlacementError(409, f"barcode conflict: sample shares a burned barcode with cell {cell.code}.")
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
            # successor rather than 409ing (see open_new_tray / _cell_resident_on).
            return open_new_tray(db, instrument_id, well, founding_date=acquire_date)[0]
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
    frontend's reuseWindow (waitingCells.ts)."""
    anchor = cell.first_use_started_at or first_use_planned_start_at(cell)
    if anchor is None:
        return True  # never used yet - no 108h clock running (not a reuse candidate in practice)
    deadline = ensure_aware(anchor) + timedelta(hours=CELL_LIFETIME_H)
    reuse_start, _ = planned_window(acquire_date, run_time_hours, start_hour, start_minute)
    return reuse_start <= deadline


def _reuse_eligible(
    db: Session,
    cell: Cell,
    *,
    instrument_serial: str,
    acquire_date: date,
    sample_barcodes: list[str],
    run_time_hours: float,
    start_hour: int,
    start_minute: int,
    external_id: str | None = None,
) -> bool:
    """Bool predicate for the auto-deriver, mirroring _resolve_cell_choice's "existing cell"
    guards (open, capacity left, barcode-disjoint unless it's the same Container ID reusing
    its own earlier burn, same instrument, not inserting ahead of an already-started later
    use) PLUS the 108h window check. Well/position pinning is enforced by how candidates are
    gathered in derive_best_cell, so it isn't re-checked here."""
    if cell.status != "open":
        return False
    _consumed, remaining, _burned = derive_cell_state(cell)
    if remaining <= 0:
        return False
    if foreign_barcode_clash(barcode_owners(cell), external_id, sample_barcodes):
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
    sample_barcodes: list[str],
    run_time_hours: float,
    start_hour: int,
    start_minute: int,
    external_id: str | None = None,
) -> Cell | None:
    """From candidate cells physically resident at a drop's instrument+carousel position,
    return the one the instrument reaches for next: reuse-before-new, the *most-used* open cell
    first (its 108h clock is nearest expiry, so it's finished before a fresh sibling is broken
    out), then unused siblings in tray order - the first that passes every reuse guard
    (_reuse_eligible: capacity, 108h window, barcode-disjoint, instrument pin, no out-of-order
    insert) for this drop. None if no candidate is eligible.

    This is the ICS "prioritise the cell expiring next / next in order" behaviour: the plate
    slot the sample is dropped onto is only a loading position - which physical cell runs it is
    picked here, and shown afterwards by the loaded card's stub (see run_serializer/StageOut)."""
    def sort_key(cell: Cell) -> tuple[int, float, int]:
        consumed = derive_cell_state(cell)[0]
        started = cell.first_use_started_at or first_use_planned_start_at(cell)
        started_key = ensure_aware(started).timestamp() if started is not None else float("inf")
        pos = cell.tray_position if cell.tray_position is not None else 99
        return (-consumed, started_key, pos)

    for cell in sorted(cells, key=sort_key):
        _plate, acquire = _plate_target(
            db, cell=cell, instrument_id=instrument.id, load_date=load_date, slot_index=slot_index
        )
        if _reuse_eligible(
            db,
            cell,
            instrument_serial=instrument.serial_number,
            acquire_date=acquire,
            sample_barcodes=sample_barcodes,
            run_time_hours=run_time_hours,
            start_hour=start_hour,
            start_minute=start_minute,
            external_id=external_id,
        ):
            return cell
    return None


def derive_best_cell(
    db: Session,
    *,
    instrument: Instrument,
    load_date: date,
    slot_index: int,
    sample_barcodes: list[str],
    run_time_hours: float,
    start_hour: int = DAY_START_HOUR,
    start_minute: int = 0,
    exclude_cell_id: int | None = None,
    external_id: str | None = None,
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
    out-of-window cell is never auto-reused - it falls through to a fresh tray instead.

    `exclude_cell_id`, when given, drops that cell from the reuse candidates. Used by
    move_sample: a sample dragged to a *different* loading well is handed to a different cell
    at the destination, never allowed to re-adopt its own cell into a foreign well - which,
    for a reused (most-used) cell, would otherwise be re-picked here and stored at the new
    well, reintroducing exactly the loading-well ≠ home-well divergence this is meant to
    prevent (see the "Plate vs cell" refinement in docs/pacbio-sprq-nx-scheduling-reference.md).

    `external_id` (the sample's Container ID) is threaded down to the barcode-clash check so
    another copy of the same duplicate Container ID can reuse a cell it already burned this
    barcode onto - only a genuinely different sample sharing that barcode still blocks reuse
    (see cell_service.foreign_barcode_clash).

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
        cands = [c for c in tray_cells if c.id != exclude_cell_id and c.id not in already_in_cycle]
        best = _pick_next_reuse_cell(
            db, cands, instrument=instrument, load_date=load_date, slot_index=slot_index,
            sample_barcodes=sample_barcodes, run_time_hours=run_time_hours,
            start_hour=start_hour, start_minute=start_minute, external_id=external_id,
        )
        if best is not None:
            return {"mode": "existing", "cell_id": best.id}
        raise PlacementError(
            409,
            f"Can't place here: this plate is already loaded from tray T{committed_tray_id} and "
            "none of its remaining cells can take this sample (capacity, barcode clash, or its "
            "108h reuse window). Try a different slot/day, or free a cell on that tray first.",
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
                and cu.cell.id != exclude_cell_id
            ]
            best = _pick_next_reuse_cell(
                db, cands, instrument=instrument, load_date=load_date, slot_index=slot_index,
                sample_barcodes=sample_barcodes, run_time_hours=run_time_hours,
                start_hour=start_hour, start_minute=start_minute, external_id=external_id,
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
        if cell.id == exclude_cell_id:
            continue  # move_sample: don't re-adopt the moved cell into a foreign well
        if _cell_used_in_run(cell, instrument.id, load_date):
            continue  # already covered by the intra-run branch above
        cands.append(cell)
    best = _pick_next_reuse_cell(
        db, cands, instrument=instrument, load_date=load_date, slot_index=slot_index,
        sample_barcodes=sample_barcodes, run_time_hours=run_time_hours,
        start_hour=start_hour, start_minute=start_minute, external_id=external_id,
    )
    if best is not None:
        return {"mode": "existing", "cell_id": best.id}

    # (3) No eligible reuse in this carousel position - open a new tray.
    return {"mode": "new"}


def _tray_pos_label(home_well: str) -> str:
    """The grid's cell-position badge for a home well - ▣1..▣4 for tray positions A..D, matching
    SchedulerSlotView's ▣N stub. Used in the plate-order error so the message names cells the
    same way the user sees them on the card."""
    return f"▣{within_tray_pos(home_well) + 1}"


def _assert_no_barcode_forced_inversion(db: Session, cycle_id: int) -> None:
    """A tray breaks its cells out in physical order - ▣1 (position A) before ▣2 before ▣3 before
    ▣4 - so across a plate's loading slots (A01→B01→C01→D01) the cells drawn from one physical
    tray must appear in that same non-decreasing order. A barcode clash can silently force a
    sample off the cell that would naturally back its slot and onto a later-position sibling,
    transposing two equally-reusable cells - e.g. slot A01 backed by ▣3 while slot B01 is backed
    by ▣2 ("cell order 3 then 2"), which a real instrument would never produce. `derive_best_cell`
    treats a slot as a pure loading position and reaches for the next-in-order *eligible* cell, so
    the clash is invisible to it (see _reuse_eligible's silent barcode skip); this catches the
    resulting impossible plate order and refuses it, naming the clashing sample, rather than
    committing it (reported by the lab owner, 2026-07-27).

    Only a *barcode-forced* transposition of two cells at the SAME reuse depth is blocked. A
    genuine difference in reuse depth (the "most-used / expiring-next first" ordering, or a
    shorter run leaving one sibling further along) legitimately puts a later-position cell in an
    earlier slot, and is left alone - exactly the lab owner's noted exception. Must run after the
    placement is flushed but before commit; the caller rolls back on the raise so nothing is
    persisted."""
    db.flush()
    # populate_existing: a sibling cell in this plate may have been last loaded in an earlier
    # (already-committed) request, leaving its cached cell_uses collection stale in the identity
    # map - which would give derive_cell_state a wrong use count and mis-fire the reuse-depth
    # exception below. Force the eager loads to overwrite that stale state.
    uses = db.scalars(
        select(CellUse)
        .where(CellUse.cycle_id == cycle_id, CellUse.status != "cancelled")
        .options(
            selectinload(CellUse.cell).selectinload(Cell.cell_uses).selectinload(CellUse.barcodes),
            selectinload(CellUse.cell).selectinload(Cell.cell_uses).selectinload(CellUse.sample),
            selectinload(CellUse.barcodes),
            selectinload(CellUse.sample),
        )
        .execution_options(populate_existing=True)
    ).all()
    # Only tray-linked cells have a fixed A/B/C/D order to violate; a legacy/bootstrap cell
    # (no tray, no home_well) has no position to compare.
    stages = [u for u in uses if u.cell is not None and u.cell.tray_id is not None and u.cell.home_well]
    for earlier in stages:
        for later in stages:
            if earlier is later or earlier.cell.tray_id != later.cell.tray_id:
                continue
            if within_tray_pos(earlier.well) >= within_tray_pos(later.well):
                continue  # `earlier` must load before `later`
            if within_tray_pos(earlier.cell.home_well) <= within_tray_pos(later.cell.home_well):
                continue  # cells already in tray order across these two slots - fine
            # A real reuse-depth difference (expiring-next / shorter-run) justifies the order.
            if derive_cell_state(earlier.cell)[0] != derive_cell_state(later.cell)[0]:
                continue
            # Barcode-forced? i.e. could `earlier`'s sample NOT have taken `later`'s (lower,
            # earlier-loading) cell, because it shares a burned barcode with it - genuinely, a
            # burn from a DIFFERENT Container ID, not just another copy of `earlier`'s own
            # duplicate sample (which is allowed to reuse `later`'s cell - see
            # cell_service.foreign_barcode_clash - so that case was never actually forced off).
            earlier_ext = earlier.sample.external_id if earlier.sample else None
            if not foreign_barcode_clash(barcode_owners(later.cell), earlier_ext, earlier.barcode_list):
                continue
            # The `earlier`-slot sample is always the culprit: it was bumped onto the
            # higher-position cell precisely because it clashes with the lower one (`later`'s
            # cell), which then landed in the later slot. That's true whichever of the two the
            # user dropped last, so the message names it regardless of drop order.
            earlier_lbl = _tray_pos_label(earlier.cell.home_well)
            later_lbl = _tray_pos_label(later.cell.home_well)
            culprit = earlier.sample.external_id if earlier.sample else "the other sample"
            raise PlacementError(
                409,
                f"Can't place here: the plate would load cell {later_lbl} after {earlier_lbl} "
                f"(slot {earlier.well} → {earlier_lbl}, slot {later.well} → {later_lbl}), but a tray "
                f"loads its cells in order ({later_lbl} before {earlier_lbl}). {culprit}'s barcode "
                f"clashes with {later_lbl}, forcing it off that cell. Move {culprit} to a different "
                f"slot or day (or onto a fresh cell) first.",
            )


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
            sample_barcodes=sample_barcodes,
            run_time_hours=run_time_hours,
            start_hour=start_hour,
            start_minute=start_minute,
            external_id=sample.external_id,
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
            barcodes=sample_barcodes,
            acquire_date=acquire_date,
            load_date=load_date,
            plate_index=plate_index,
            external_id=sample.external_id,
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
            # carousel position instead of 409ing (see open_new_tray / _cell_resident_on).
            cell = open_new_tray(db, instrument.id, well, founding_date=acquire_date)[0]
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

    recompute_cycle_timing(db, cycle)
    db.refresh(cell, attribute_names=["cell_uses"])
    recompute_status(cell, utcnow())

    try:
        _assert_no_barcode_forced_inversion(db, cycle.id)
    except PlacementError:
        db.rollback()
        raise

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

    # A grid slot is a plate LOADING position, not a cell, but a physical cell is fixed to its
    # own tray/well position for life - so a cell renders in whichever loading slot it currently
    # occupies, and moving a sample to a *different* loading well hands it to the cell the
    # instrument would reach for at that slot (reuse-before-new, via derive_best_cell / the
    # cell_choice path below) rather than dragging the sample's current physical cell into a
    # foreign well. Without this, a within-box drag rewrites CellUse.well while keeping the cell,
    # letting two fresh cells swap slots: a still-has-capacity cell A gets displaced out of slot
    # A01 and a fresh drop back into A01 then resolves to cell B - the reported "slot A01 = cell
    # B Use 1 while cell A still has capacity" transposition (see the "Plate vs cell" refinement
    # in docs/pacbio-sprq-nx-scheduling-reference.md; a fresh cell must always be the earliest in
    # tray order). A *same-well* move (a plain reschedule to another day, same slot) keeps the
    # cell in place. A cross-instrument or cross-carousel-box move necessarily changes the well
    # too, so this single check subsumes both of those older triggers.
    reassign_to_new_cell = pinned_serial is not None and pinned_serial != instrument_serial
    if not reassign_to_new_cell and dest_well != cell_use.well:
        reassign_to_new_cell = True
    if not reassign_to_new_cell and cell_choice is not None:
        # An explicit override to a fresh tray, or to a *different* existing cell, is honoured
        # even when the sample's current cell could have stayed. Naming the same cell it's
        # already on is not an override - fall through to the in-place reschedule.
        if cell_choice.get("mode") == "new" or cell_choice.get("cell_id") != cell.id:
            reassign_to_new_cell = True

    if reassign_to_new_cell and cell_choice is None:
        # No explicit target cell - derive the next-in-order cell at the destination, same as a
        # fresh drop (reuse-before-new, see derive_best_cell), so a plain drag "just works".
        # Exclude the moved cell itself: the sample must land on a *different* cell at the
        # destination well, never re-adopt its own cell into a foreign well.
        cell_choice = derive_best_cell(
            db,
            instrument=instrument,
            load_date=load_date,
            slot_index=slot_index,
            sample_barcodes=cell_use.barcode_list,
            run_time_hours=run_time_hours,
            start_hour=start_hour,
            start_minute=start_minute,
            exclude_cell_id=cell.id,
            external_id=cell_use.sample.external_id if cell_use.sample else None,
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

    # --- writes: same-cell reschedule ---
    # The cell keeps its own well; the plate/acquire day come from the slot, or - if this
    # cell is (still) loaded in the destination run via another use - the reuse Plate 2.
    plate_index, acquire_date = _plate_target(
        db, cell=cell, instrument_id=instrument.id, load_date=load_date, slot_index=slot_index, exclude_use_id=cell_use.id
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
    if not same_cycle:
        _cleanup_emptied_plate(db, old_cycle)

    # Destination gains this well (its representative run time may now be longer).
    recompute_cycle_timing(db, dest_cycle)

    try:
        _assert_no_barcode_forced_inversion(db, dest_cycle.id)
    except PlacementError:
        db.rollback()
        raise

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
    (a cell never crosses instruments) or a different carousel position - so hand the sample to
    `cell_choice`'s resolved cell instead. One transaction: a new CellUse under the resolved
    cell replaces this one, and the sample's status never bounces through "backlog" in between
    (unlike a naive remove-then-place)."""
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
    if mode == "existing":
        cell_id = cell_choice.get("cell_id")
        if cell_id is None:
            raise PlacementError(400, "cell_choice.cell_id is required when mode is 'existing'.")
        prelim = db.get(Cell, cell_id, options=[selectinload(Cell.cell_uses).selectinload(CellUse.cycle).selectinload(Cycle.run_batch)])
        plate_index, acquire_date = _plate_target(
            db, cell=prelim, instrument_id=instrument.id, load_date=load_date, slot_index=slot_index
        )
    else:
        plate_index, acquire_date = _plate_target(
            db, cell=None, instrument_id=instrument.id, load_date=load_date, slot_index=slot_index
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
        barcodes=barcodes,
        acquire_date=acquire_date,
        load_date=load_date,
        plate_index=plate_index,
        external_id=cell_use.sample.external_id if cell_use.sample else None,
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
        _cleanup_emptied_plate(db, old_cycle)

    recompute_cycle_timing(db, dest_cycle)

    now = utcnow()
    _release_cell(db, old_cell, now)
    db.refresh(new_cell, attribute_names=["cell_uses"])
    recompute_status(new_cell, now)

    try:
        _assert_no_barcode_forced_inversion(db, dest_cycle.id)
    except PlacementError:
        db.rollback()
        raise

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
    well) unique constraint all stay structurally unaffected, with nothing left to
    re-validate beyond a barcode clash. Returns the affected run(s)."""
    if cell_use_id_a == cell_use_id_b:
        raise PlacementError(400, "Cannot swap a placement with itself.")

    options = [
        selectinload(CellUse.cycle).selectinload(Cycle.run_batch),
        selectinload(CellUse.cell).selectinload(Cell.cell_uses).selectinload(CellUse.barcodes),
        selectinload(CellUse.cell).selectinload(Cell.cell_uses).selectinload(CellUse.sample),
        selectinload(CellUse.barcodes),
        selectinload(CellUse.sample),
    ]
    use_a = db.get(CellUse, cell_use_id_a, options=options)
    use_b = db.get(CellUse, cell_use_id_b, options=options)
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

    cell_a, cell_b = use_a.cell, use_b.cell
    sample_a_id, sample_b_id = use_a.sample_id, use_b.sample_id
    sample_a_barcodes, sample_b_barcodes = use_a.barcode_list, use_b.barcode_list
    sample_a_ext = use_a.sample.external_id if use_a.sample else None
    sample_b_ext = use_b.sample.external_id if use_b.sample else None

    if cell_a.id != cell_b.id:
        # Barcode clash is only a real concern crossing cells - two uses of the *same*
        # physical cell already share one burned-barcode set, so a same-cell swap can
        # never introduce a new clash. A clash against a burn from the SAME Container ID
        # (another copy of a duplicate sample) is allowed - see cell_service.foreign_barcode_clash.
        def owners_excluding(cell: Cell, exclude_use_id: int) -> dict[str, set[str]]:
            uses = [cu for cu in cell.cell_uses if cu.id != exclude_use_id and cu.status != "cancelled"]
            return barcode_owners(cell, uses)

        if foreign_barcode_clash(owners_excluding(cell_a, use_a.id), sample_b_ext, sample_b_barcodes):
            raise PlacementError(
                409,
                f"barcode conflict: moving this sample onto cell {cell_a.code} clashes with a "
                f"barcode already burned there by a different sample.",
            )
        if foreign_barcode_clash(owners_excluding(cell_b, use_b.id), sample_a_ext, sample_a_barcodes):
            raise PlacementError(
                409,
                f"barcode conflict: moving this sample onto cell {cell_b.code} clashes with a "
                f"barcode already burned there by a different sample.",
            )

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
