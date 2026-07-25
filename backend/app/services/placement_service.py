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

from app.engine.constants import CELL_LIFETIME_H, DAY_START_HOUR, REUSE_PREP_H, WELLS, within_tray_pos
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
    run_has_started,
    use_run_date,
    use_sort_key,
)
from app.services.engine_bridge import load_prior_cells
from app.timeutil import ensure_aware, utcnow

# A run's two loading positions (deck trays). slot_index 0-3 = Plate 1, 4-7 = Plate 2.
PLATE_SIZE = len(WELLS) // 2  # 4


def _within_tray_pos(well: str) -> int:
    """The A/B/C/D position (0-3) of a well within its tray box (see constants.within_tray_pos,
    the single source shared with run_serializer._slot_index). A cell keeps this fixed position
    for life, so a reuse into Plate 2 legitimately lands the same letter (e.g. A01 on a
    nominal-A02 grid slot) - both share within-tray position 0."""
    return within_tray_pos(well)


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
        # Gate new-run creation against a prior run's lock. The new run's earliest start is
        # Plate 1 on the load day (start hour), regardless of which plate is being created now.
        # A lock that clears *on* the load day doesn't block it - the instrument frees up that
        # day, so the run just starts when it's free (bumping start_hour/minute to the lock's
        # end); only a lock spanning the whole load day blocks it (see
        # instrument_lock.resolve_new_run_start).
        gate_start, _ = planned_window(load_date, run_time_hours, start_hour, start_minute)
        effective_start = instrument_lock.resolve_new_run_start(db, instrument.id, load_date, gate_start)
        if effective_start is None:
            blocking = instrument_lock.latest_lock_until(db, instrument.id, load_date)
            raise PlacementError(
                409,
                f"Instrument {instrument.serial_number} is locked until "
                f"{blocking.isoformat() if blocking else '?'} by a prior run.",
            )
        start_hour, start_minute = effective_start.hour, effective_start.minute
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
    requested_well: str | None = None,
) -> Cell:
    """Shared "which cell hosts this sample" resolution, shared by place_sample and
    move_sample's cell-reassignment path: mode "new" opens a fresh tray pinned to `well`;
    mode "existing" validates the chosen cell is open, has capacity, has no burned-barcode
    clash with these barcodes, is already pinned to this exact instrument/well once it has a
    prior use (cells stay in the same physical tray/well position for every reuse), and - see
    the chronological-order check below - isn't displacing an already-started later use of
    the same cell.

    `requested_well` is the nominal well of the grid slot the user actually dropped onto
    (WELLS[slot_index]); the pin guard rejects when it isn't the cell's own well position, so
    the physical cell can't be dragged off its fixed tray/well slot. `well` is the well this
    placement is stored at - the cell's own pinned well for a reuse, which is why the guard
    can't compare against it (it's derived from the cell and so always matches)."""
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
                selectinload(Cell.tray).selectinload(CellTray.instrument),
            ],
        )
        if cell is None:
            raise PlacementError(404, f"Cell {cell_id} not found.")
        if cell.status != "open":
            raise PlacementError(409, f"Cell {cell.code} is not open (status: {cell.status}).")
        _consumed, remaining, burned = derive_cell_state(cell)
        if remaining <= 0:
            raise PlacementError(409, f"Cell {cell.code} has no remaining uses.")
        if any(bc in set(burned) for bc in barcodes):
            raise PlacementError(409, f"barcode conflict: sample shares a burned barcode with cell {cell.code}.")
        current_serial, current_well = current_location(cell)
        if current_serial is not None and current_serial != instrument_serial:
            raise PlacementError(
                409,
                f"Cell {cell.code} is already in use on instrument {current_serial}; "
                f"cannot place it on {instrument_serial}.",
            )
        # Cells stay in the same physical tray/well position for every reuse - once a
        # cell has a well of its own, only a grid slot in that same within-tray position can
        # host its next use (its own well on Plate 1, or the same letter on Plate 2 for a
        # reuse). Validate against the slot the user actually dropped onto, not the derived
        # storage `well` (which is the cell's own well, so it would always match).
        target_well = requested_well if requested_well is not None else well
        if current_well is not None and _within_tray_pos(current_well) != _within_tray_pos(target_well):
            raise PlacementError(
                409,
                f"Cell {cell.code} must stay in well {current_well} (its last used slot); "
                f"cannot place it in well {target_well}.",
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
        try:
            return open_new_tray(db, instrument_id, well)[0]
        except ValueError as exc:
            raise PlacementError(409, str(exc)) from exc
    else:
        raise PlacementError(400, f"Unknown cell_choice.mode '{mode}'.")


def _existing_cell_well(db: Session, cell_id: int, instrument_id: int) -> str | None:
    """The pinned well an existing cell must stay in (its last used slot, or its tray
    home_well), used to derive the placement well before validation - a reuse keeps the
    cell's own well, never the slot's nominal well. None if the cell can't be found."""
    cell = db.get(
        Cell,
        cell_id,
        options=[
            selectinload(Cell.cell_uses).selectinload(CellUse.cycle).selectinload(Cycle.run_batch),
            selectinload(Cell.tray).selectinload(CellTray.instrument),
        ],
    )
    if cell is None:
        return None
    _serial, current_well = current_location(cell)
    return current_well or cell.home_well


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
) -> bool:
    """Bool predicate for the auto-deriver, mirroring _resolve_cell_choice's "existing cell"
    guards (open, capacity left, barcode-disjoint, same instrument, not inserting ahead of an
    already-started later use) PLUS the 108h window check. Well/position pinning is enforced by
    how candidates are gathered in derive_best_cell, so it isn't re-checked here."""
    if cell.status != "open":
        return False
    _consumed, remaining, burned = derive_cell_state(cell)
    if remaining <= 0:
        return False
    if any(bc in set(burned) for bc in sample_barcodes):
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
) -> dict:
    """Pick the physical cell a manually-dropped sample should use, applying the same
    reuse-before-new rule the batch engine (pack_cells) uses: reuse an eligible open cell if
    one is available at this slot's position, else open a new tray. Returns a cell_choice dict
    (``{"mode":"existing","cell_id":N}`` or ``{"mode":"new"}``) understood by place_sample /
    move_sample - so an auto placement flows through the exact same persistence path as an
    explicit choice, just with the cell decided server-side.

    Two reuse shapes are considered, mirroring the two the frontend already surfaces (my
    Plate-2 picker default and the waiting-cell ghosts):
      1. **Intra-run Plate-2 reuse** - a cell already loaded in THIS run's Plate 1 at the
         aligned within-tray position (a drop onto a Plate-2 slot) -> its sequential Use 2,
         acquiring the next weekday (via _plate_target). This is the one-tray reuse run and
         the low-throughput case.
      2. **Cross-run reuse** - an idle open cell pinned to this slot's *exact* well on this
         instrument (the cell whose reuse ghost sits on this slot) -> a new run's plate,
         acquiring the load day.
    The first *eligible* of (1) then (2) wins; otherwise a brand-new cell. Eligibility
    (see _reuse_eligible) includes the 108h window, so an out-of-window cell is never
    auto-reused - it falls through to a new cell instead."""
    target_well = WELLS[slot_index]

    # (1) Intra-run Plate-2 reuse: the cell in this run's Plate 1 at the aligned position.
    if slot_index >= PLATE_SIZE:
        run_batch = db.scalar(
            select(RunBatch)
            .where(RunBatch.instrument_id == instrument.id, RunBatch.load_date == load_date)
            .options(selectinload(RunBatch.cycles).selectinload(Cycle.cell_uses).selectinload(CellUse.cell))
        )
        if run_batch is not None:
            plate1 = next((c for c in run_batch.cycles if c.plate_index == 1), None)
            if plate1 is not None:
                position = slot_index % PLATE_SIZE
                aligned = next(
                    (
                        cu
                        for cu in plate1.cell_uses
                        if cu.status != "cancelled" and cu.cell is not None and _within_tray_pos(cu.well) == position
                    ),
                    None,
                )
                if aligned is not None:
                    _plate, acquire = _plate_target(
                        db, cell=aligned.cell, instrument_id=instrument.id, load_date=load_date, slot_index=slot_index
                    )
                    if _reuse_eligible(
                        db,
                        aligned.cell,
                        instrument_serial=instrument.serial_number,
                        acquire_date=acquire,
                        sample_barcodes=sample_barcodes,
                        run_time_hours=run_time_hours,
                        start_hour=start_hour,
                        start_minute=start_minute,
                    ):
                        return {"mode": "existing", "cell_id": aligned.cell.id}

    # (2) Cross-run reuse: an idle open cell pinned to this exact well on this instrument.
    prior, by_id = load_prior_cells(db, [])
    for pc in prior:
        if pc.pinned_instrument_serial != instrument.serial_number or pc.pinned_well != target_well:
            continue
        cell = by_id[pc.cell_id]
        if _cell_used_in_run(cell, instrument.id, load_date):
            continue  # already covered by the intra-run branch above
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
        ):
            return {"mode": "existing", "cell_id": cell.id}

    # (3) No eligible reuse anywhere on this slot - open a new cell.
    return {"mode": "new"}


def place_sample(
    db: Session,
    *,
    sample_id: int,
    instrument_serial: str,
    load_date: date,
    slot_index: int,
    cell_choice: dict | None = None,
    run_time_hours: float,
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
        )
    mode = cell_choice.get("mode")

    # Resolve the target well, plate and acquire day. A new/fresh cell takes the slot's own
    # deck well and acquires the load day; an existing cell keeps its own pinned well, and if
    # it's already in this run it becomes the sequential reuse Plate 2 (a later acquire day).
    existing_cell: Cell | None = None
    if mode == "existing":
        cell_id = cell_choice.get("cell_id")
        if cell_id is None:
            raise PlacementError(400, "cell_choice.cell_id is required when mode is 'existing'.")
        well = _existing_cell_well(db, cell_id, instrument.id) or WELLS[slot_index]
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
            requested_well=WELLS[slot_index],
        )
    elif mode == "new":
        well = WELLS[slot_index]
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
        try:
            cell = open_new_tray(db, instrument.id, well)[0]
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


def remove_sample(db: Session, cell_use_id: int, actor: str | None = None) -> None:
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

    # Lock the cycle row so concurrent removals of sibling stages on the same plate (e.g.
    # the "Remove from schedule" multi-select and "Clear schedule" bulk actions, which fire
    # one DELETE per stage concurrently via Promise.all) serialize here instead of racing on
    # the "any stages left?" count. No-op on SQLite (dev), which doesn't support FOR UPDATE.
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
    db.commit()


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

    If the destination well is genuinely still "owned" by this same physical cell (either
    because another of its own uses already sits there, or - for a cell with only this one
    use so far - because nothing else has ever claimed that exact well on that instrument),
    this is an in-place update of the CellUse's plate/well - the same physical cell just
    repositions, never a delete+recreate. That avoids two real problems a client-side
    remove-then-place has: a rejected re-place leaving the sample stranded in backlog with
    the old slot already gone, and the old cell being deleted (as an emptied placeholder)
    out from under a move that intended to reuse it.

    If the destination well conflicts with the cell's own established pin, OR a different
    physical cell is already resident in that exact well (e.g. an eagerly-opened tray
    sibling, or an earlier tray that hasn't yet been superseded), the cell itself can't go
    there (cells stay in the same physical tray/well position for every reuse - see
    docs/pacbio-sprq-nx-scheduling-reference.md) - moving the *sample* there instead means
    handing it to a different cell, resolved via `cell_choice` exactly like a fresh
    placement. See _move_sample_to_new_cell for that path's own atomicity guarantees."""
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
            selectinload(CellUse.cell).selectinload(Cell.cell_uses).selectinload(CellUse.cycle).selectinload(
                Cycle.run_batch
            ).selectinload(RunBatch.instrument),
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

    # The destination well the cell itself would need: for a cell with other uses it's pinned
    # to their shared well; for a lone-use cell the slot's own nominal well applies. Used only
    # to decide same-cell vs reassign; the actual stored well for an in-place move is the
    # cell's own well (unchanged), which equals WELLS[slot_index] only when they don't conflict.
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

    # A sample isn't physically loaded onto anything until its run executes, so re-pointing an
    # unexecuted placement at a different instrument is just re-planning. The physical Cell
    # still can never move between instruments once it has a real use, so crossing instruments
    # always means handing the sample to a (possibly new) cell on the destination instrument.
    reassign_to_new_cell = pinned_serial is not None and pinned_serial != instrument_serial
    if other_uses and not reassign_to_new_cell:
        # Cells stay in the same physical tray/well position for every reuse - the cell
        # itself can't take this well, so the sample has to go to a different cell there.
        if dest_well not in {cu.well for cu in other_uses}:
            reassign_to_new_cell = True

    if not reassign_to_new_cell:
        # A tray-linked cell's home_well is its one true physical slot for life (see
        # docs/pacbio-sprq-nx-scheduling-reference.md), so if the destination well isn't it,
        # the cell itself can't go there - regardless of whether anything else sits in it.
        if cell.home_well is not None and cell.home_well != dest_well:
            reassign_to_new_cell = True
        else:
            # bootstrap_cell() cells have no tray/home_well: fall back to the box-collision
            # check. If a *different*, still-open physical cell already sits in this exact
            # (instrument, well), that cell - not the one being dragged - is the one this
            # sample must land on. Mirrors open_new_tray()'s own box-collision query.
            resident_cell_id = db.scalar(
                select(Cell.id)
                .join(Cell.tray)
                .where(
                    CellTray.instrument_id == instrument.id,
                    Cell.home_well == dest_well,
                    Cell.status == "open",
                    Cell.id != cell.id,
                )
            )
            if resident_cell_id is not None:
                reassign_to_new_cell = True

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
    """The dragged cell can't take this well - either it's pinned elsewhere by another of
    its own uses, or a different physical cell is already resident in the destination well
    - so hand the sample to `cell_choice`'s resolved cell instead. One transaction: a new
    CellUse under the resolved cell replaces this one, and the sample's status never
    bounces through "backlog" in between (unlike a naive remove-then-place)."""
    old_cell = cell_use.cell
    if cell_choice is None:
        raise PlacementError(
            400,
            f"Cell {old_cell.code} must stay in well {cell_use.well}; "
            f"cell_choice is required to move this sample to slot {slot_index}.",
        )

    barcodes = cell_use.barcode_list
    mode = cell_choice.get("mode")

    # Same plate/well/acquire resolution as a fresh placement onto the destination.
    if mode == "existing":
        cell_id = cell_choice.get("cell_id")
        if cell_id is None:
            raise PlacementError(400, "cell_choice.cell_id is required when mode is 'existing'.")
        well = _existing_cell_well(db, cell_id, instrument.id) or WELLS[slot_index]
        prelim = db.get(Cell, cell_id, options=[selectinload(Cell.cell_uses).selectinload(CellUse.cycle).selectinload(Cycle.run_batch)])
        plate_index, acquire_date = _plate_target(
            db, cell=prelim, instrument_id=instrument.id, load_date=load_date, slot_index=slot_index
        )
    else:
        well = WELLS[slot_index]
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
        requested_well=WELLS[slot_index],
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
        selectinload(CellUse.barcodes),
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

    if cell_a.id != cell_b.id:
        # Barcode clash is only a real concern crossing cells - two uses of the *same*
        # physical cell already share one burned-barcode set, so a same-cell swap can
        # never introduce a new clash.
        def burned_excluding(cell: Cell, exclude_use_id: int) -> set[str]:
            burned: set[str] = set()
            for cu in cell.cell_uses:
                if cu.id == exclude_use_id or cu.status == "cancelled":
                    continue
                burned.update(cu.barcode_list)
            return burned

        clash_b_on_a = burned_excluding(cell_a, use_a.id) & set(sample_b_barcodes)
        if clash_b_on_a:
            raise PlacementError(
                409,
                f"barcode conflict: moving this sample onto cell {cell_a.code} clashes with "
                f"barcode(s) {', '.join(sorted(clash_b_on_a))} already burned there.",
            )
        clash_a_on_b = burned_excluding(cell_b, use_b.id) & set(sample_a_barcodes)
        if clash_a_on_b:
            raise PlacementError(
                409,
                f"barcode conflict: moving this sample onto cell {cell_b.code} clashes with "
                f"barcode(s) {', '.join(sorted(clash_a_on_b))} already burned there.",
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
