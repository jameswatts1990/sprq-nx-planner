"""Interactive placement: users drag one sample onto one (instrument, day, slot) grid
cell at a time. Each placement gets-or-creates the (instrument, run_date) run under a
unique constraint, resolves a fresh or reused SMRT-cell, and records the CellUse.

Errors are raised as PlacementError(status_code, detail); the API layer maps them to
HTTPExceptions. Validation is done read-only before any DB writes so a rejected request
never leaves half-written rows in a shared session."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.engine.constants import DAY_START_HOUR, WELLS
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
    open_new_tray,
    recompute_status,
    run_has_started,
    use_run_date,
)
from app.timeutil import utcnow


class PlacementError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def planned_window(
    run_date: date, run_time_hours: float, start_hour: int = DAY_START_HOUR, start_minute: int = 0
) -> tuple[datetime, datetime]:
    start = datetime.combine(run_date, time(hour=start_hour, minute=start_minute), tzinfo=timezone.utc)
    return start, start + timedelta(hours=run_time_hours)


def get_or_create_run(
    db: Session,
    *,
    instrument: Instrument,
    run_date: date,
    run_time_hours: float,
    start_hour: int = DAY_START_HOUR,
    start_minute: int = 0,
) -> Cycle:
    """Get-or-create the (instrument, run_date) RunBatch+Cycle. Normally 1:1 - created and
    deleted together everywhere else in this module - but a RunBatch can legitimately
    survive with no Cycle if its cycles were deleted independently (e.g. via the admin
    table-clear tool, which clears one raw table at a time with no cascade). Handled here
    by attaching a fresh Cycle to the existing, cycle-less RunBatch rather than trying
    (and failing on the unique constraint) to INSERT a second RunBatch row for the same
    (instrument, run_date).

    Safe against a concurrent drag into the same empty grid cell: on a losing INSERT race
    we roll back the failed insert and re-SELECT the winner's row.

    NOTE: the rollback discards the whole pending transaction, so callers must invoke this
    before making any other DB writes they care about."""

    def _load_run_batch() -> RunBatch | None:
        return db.scalar(
            select(RunBatch)
            .where(RunBatch.instrument_id == instrument.id, RunBatch.run_date == run_date)
            .options(selectinload(RunBatch.cycles))
        )

    run_batch = _load_run_batch()
    if run_batch is not None and run_batch.cycles:
        return run_batch.cycles[0]

    start, end = planned_window(run_date, run_time_hours, start_hour, start_minute)

    # A brand-new run's start time must not fall before a prior run's lock ends on this
    # same instrument. This only gates *creating* a new run - adding another sample to an
    # already-existing run (the branch above) is never blocked, so loading the next run's
    # cells while the current one is still locked remains possible.
    blocking = instrument_lock.latest_lock_until(db, instrument.id, run_date)
    if blocking is not None and start < blocking:
        raise PlacementError(
            409, f"Instrument {instrument.serial_number} is locked until {blocking.isoformat()} by a prior run."
        )

    if run_batch is None:
        run_batch = RunBatch(instrument_id=instrument.id, run_date=run_date)
        db.add(run_batch)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            run_batch = _load_run_batch()
            if run_batch is None:
                raise
            if run_batch.cycles:
                return run_batch.cycles[0]
            # else: the concurrent writer created the RunBatch but hasn't attached a Cycle
            # yet - fall through and create one for it below, same as the orphan case.

    cycle = Cycle(
        run_batch_id=run_batch.id,
        movie_hours=int(run_time_hours),
        planned_start_at=start,
        planned_end_at=end,
        status="planned",
    )
    db.add(cycle)
    db.flush()
    return cycle


def _release_cell(db: Session, cell: Cell, now: datetime) -> None:
    """Shared cleanup once a cell loses one of its uses - remove_sample and
    move_sample's cell-reassignment path both hit exactly this same
    decision: recompute status if the cell still has other uses, delete it outright if it
    was only ever a placeholder for the use just lost (no tray backing it - it can never
    legitimately exist as an orphan "open, 0/3" cell), or otherwise leave it open as a real
    physical tray sibling unless every sibling in its tray is also down to 0 uses."""
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
    run_date: date,
) -> Cell:
    """Shared "which cell hosts this sample" resolution, shared by place_sample and
    move_sample's cell-reassignment path: mode "new" opens a fresh tray
    pinned to `well`; mode "existing" validates the chosen cell is open, has capacity, has
    no burned-barcode clash with these barcodes, is already pinned to this exact
    instrument/well once it has a prior use (cells stay in the same physical tray/well
    position for every reuse), and - see the chronological-order check below - isn't
    displacing an already-started later use of the same cell."""
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
        # cell has a well of its own, only that exact well can host its next use.
        if current_well is not None and current_well != well:
            raise PlacementError(
                409,
                f"Cell {cell.code} must stay in well {current_well} (its last used slot); "
                f"cannot place it in well {well}.",
            )
        # A cell's next use may already be scheduled for a later day than `run_date` (see
        # waitingCells.ts's pendingReuseStatus ghost, the "Scheduled" placeholder the grid
        # lets a sample be dropped onto ahead of that later use). Inserting this use only
        # bumps the later one to a higher Use N - it's never removed, and use numbering is
        # already derived live by run_date order (run_serializer._use_number) - so this is
        # only safe while that later use is still pure planning. Reuse must stay strictly
        # sequential once a use has actually started in the lab (see
        # docs/pacbio-sprq-nx-scheduling-reference.md #4), so any other use already running
        # blocks an earlier insert ahead of it, regardless of which use that is.
        for other in cell.cell_uses:
            if other.status == "cancelled":
                continue
            other_date = use_run_date(other)
            if other_date is None or other_date <= run_date:
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


def place_sample(
    db: Session,
    *,
    sample_id: int,
    instrument_serial: str,
    run_date: date,
    slot_index: int,
    cell_choice: dict,
    run_time_hours: float,
    start_hour: int = DAY_START_HOUR,
    start_minute: int = 0,
    actor: str | None = None,
) -> Cycle:
    # --- read-only validation (before any writes) ---
    if run_date.weekday() >= 5:
        raise PlacementError(400, f"{run_date.isoformat()} is a weekend - runs are weekdays only.")

    if not 0 <= slot_index < len(WELLS):
        raise PlacementError(400, f"slot_index must be 0-{len(WELLS) - 1}.")
    well = WELLS[slot_index]

    sample = db.get(Sample, sample_id, options=[selectinload(Sample.barcodes)])
    if sample is None:
        raise PlacementError(404, f"Sample {sample_id} not found.")
    if sample.status != "backlog":
        raise PlacementError(400, f"Only backlog samples can be placed (current status: {sample.status}).")

    instrument = db.scalar(select(Instrument).where(Instrument.serial_number == instrument_serial))
    if instrument is None:
        raise PlacementError(400, f"Unknown instrument serial '{instrument_serial}'.")

    sample_barcodes = sample.barcode_list

    # Resolve the target cell up-front for the "existing" mode so we can reject read-only.
    existing_cell: Cell | None = None
    mode = cell_choice.get("mode")
    if mode == "existing":
        existing_cell = _resolve_cell_choice(
            db,
            cell_choice,
            instrument_id=instrument.id,
            instrument_serial=instrument_serial,
            well=well,
            barcodes=sample_barcodes,
            run_date=run_date,
        )
    elif mode != "new":
        raise PlacementError(400, f"Unknown cell_choice.mode '{mode}'.")

    # --- writes ---
    cycle = get_or_create_run(
        db,
        instrument=instrument,
        run_date=run_date,
        run_time_hours=run_time_hours,
        start_hour=start_hour,
        start_minute=start_minute,
    )

    if cycle.movie_hours != int(run_time_hours):
        raise PlacementError(
            409,
            f"This run is already set to {cycle.movie_hours}h; cannot mix a {int(run_time_hours)}h placement into it.",
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
        status="planned",
    )
    db.add(cell_use)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise PlacementError(409, f"slot already occupied: well {well} is taken on this run.")

    for bc in sample_barcodes:
        db.add(CellUseBarcode(cell_use_id=cell_use.id, barcode=bc))

    sample.status = "scheduled"

    db.refresh(cell, attribute_names=["cell_uses"])
    recompute_status(cell, utcnow())

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
                "well": well,
                "instrument_serial": instrument_serial,
                "run_date": run_date.isoformat(),
            },
        )
    )
    db.commit()
    db.refresh(cycle)
    return cycle


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
    run_batch = cycle.run_batch

    # Lock the cycle row so concurrent removals of sibling stages on the same cycle (e.g.
    # the "Remove from schedule" multi-select and "Clear schedule" bulk actions, which fire
    # one DELETE per stage concurrently via Promise.all) serialize here instead of racing on
    # the "any stages left?" count below. Without this, two concurrent removals can each see
    # 1 remaining stage (the other's still-uncommitted delete) and both skip cleanup,
    # leaving a stage-less Cycle/RunBatch behind - which then blocks that grid cell from
    # selection even though it renders empty. No-op on SQLite (dev), which doesn't support
    # FOR UPDATE but has no concurrent-writer race to begin with.
    db.execute(select(Cycle.id).where(Cycle.id == cycle_id).with_for_update())

    if cell_use.sample is not None:
        cell_use.sample.status = "backlog"

    db.delete(cell_use)
    db.flush()

    remaining = db.scalar(select(func.count()).select_from(CellUse).where(CellUse.cycle_id == cycle_id))
    if remaining == 0 and run_batch is not None:
        # frees the run_time_hours choice for that grid cell again
        db.delete(run_batch)

    if cell is not None:
        _release_cell(db, cell, utcnow())

    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="remove_sample",
            entity_type="cell_use",
            entity_id=cell_use_id,
            details_json={"cycle_id": cycle_id, "cycle_deleted": remaining == 0},
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
    are told apart by cell.discarded_at, which only a discard ever sets. Cycle/run cleanup
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
    cycle_id = cycle.id if cycle is not None else None
    run_batch = cycle.run_batch if cycle is not None else None
    sample = cell_use.sample
    sample_id = cell_use.sample_id

    if cycle_id is not None:
        # Serialize concurrent recoveries of sibling blocked stages on the same cycle, the
        # same way remove_sample guards its own count - no-op on SQLite (dev).
        db.execute(select(Cycle.id).where(Cycle.id == cycle_id).with_for_update())

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

    if cycle_id is not None:
        remaining = db.scalar(select(func.count()).select_from(CellUse).where(CellUse.cycle_id == cycle_id))
        if remaining == 0 and run_batch is not None:
            db.delete(run_batch)

    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="return_cancelled_use_to_backlog",
            entity_type="cell_use",
            entity_id=cell_use_id,
            details_json={"sample_id": sample_id, "cycle_id": cycle_id},
        )
    )
    db.commit()
    return sample_id


def move_sample(
    db: Session,
    *,
    cell_use_id: int,
    instrument_serial: str,
    run_date: date,
    slot_index: int,
    run_time_hours: float,
    start_hour: int = DAY_START_HOUR,
    start_minute: int = 0,
    cell_choice: dict | None = None,
    actor: str | None = None,
) -> Cycle:
    """Move an existing placement to a different (instrument, day, slot).

    If the destination well is genuinely still "owned" by this same physical cell (either
    because another of its own uses already sits there, or - for a cell with only this one
    use so far - because nothing else has ever claimed that exact well on that instrument),
    this is an in-place update of the CellUse's cycle/well - the same physical cell just
    repositions to a different day, never a delete+recreate. That avoids two real problems
    a client-side remove-then-place has: a rejected re-place leaving the sample stranded in
    backlog with the old slot already gone, and the old cell being deleted (as an emptied
    placeholder) out from under a move that intended to reuse it.

    If the destination well conflicts with the cell's own established pin, OR a different
    physical cell is already resident in that exact well (e.g. an eagerly-opened tray
    sibling, or an earlier tray that hasn't yet been superseded), the cell itself can't go
    there (cells stay in the same physical tray/well position for every reuse - see
    docs/pacbio-sprq-nx-scheduling-reference.md) - moving the *sample* there instead means
    handing it to a different cell, resolved via `cell_choice` exactly like a fresh
    placement. See _move_sample_to_new_cell for that path's own atomicity guarantees."""
    # --- read-only validation (before any writes) ---
    if run_date.weekday() >= 5:
        raise PlacementError(400, f"{run_date.isoformat()} is a weekend - runs are weekdays only.")
    if not 0 <= slot_index < len(WELLS):
        raise PlacementError(400, f"slot_index must be 0-{len(WELLS) - 1}.")
    well = WELLS[slot_index]

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

    instrument = db.scalar(select(Instrument).where(Instrument.serial_number == instrument_serial))
    if instrument is None:
        raise PlacementError(400, f"Unknown instrument serial '{instrument_serial}'.")

    cell = cell_use.cell
    other_uses = [cu for cu in cell.cell_uses if cu.id != cell_use.id and cu.status != "cancelled"]
    # A cell's pinned instrument comes from whichever of its uses is authoritative for
    # "where this physical cell currently is": its other real uses if it has any, or - for
    # a cell with no other uses yet - this very use's own (old) run batch, since that's
    # the only placement that's ever pinned this cell anywhere so far. Without this
    # fallback, a cell with no other uses skipped the instrument check entirely and a
    # cross-instrument move would silently rewrite this CellUse onto another instrument's
    # cycle - the physical cell's tray never actually moved, so its derived pin would then
    # disagree with where its own use says it is.
    if other_uses:
        last_other = max(other_uses, key=lambda cu: (use_run_date(cu) or date.min, cu.id))
        pinned_run_batch = last_other.cycle.run_batch if last_other.cycle else None
    else:
        pinned_run_batch = old_cycle.run_batch
    pinned_serial = pinned_run_batch.instrument.serial_number if pinned_run_batch and pinned_run_batch.instrument else None

    # A sample isn't physically loaded onto anything until its run actually executes - it
    # sits on a plate until then - so re-pointing an unexecuted placement at a different
    # instrument is just re-planning, not relocating a physical object. The physical Cell
    # itself still can never move between instruments once it has a real use (see
    # docs/pacbio-sprq-nx-scheduling-reference.md), so crossing instruments always means
    # handing the sample to a (possibly new) cell on the destination instrument instead,
    # exactly like the same-instrument well-conflict case below - never a hard rejection.
    reassign_to_new_cell = pinned_serial is not None and pinned_serial != instrument_serial
    if other_uses and not reassign_to_new_cell:
        # Cells stay in the same physical tray/well position for every reuse - the cell
        # itself can't take this well, so the sample has to go to a different cell there.
        if well not in {cu.well for cu in other_uses}:
            reassign_to_new_cell = True

    if not reassign_to_new_cell:
        # Even with no other uses yet, this cell's own tray may not be the one that
        # belongs in the destination well at all. A tray-linked cell's home_well is its
        # one true physical slot for life (set once in open_new_tray(), never rewritten -
        # see docs/pacbio-sprq-nx-scheduling-reference.md), so if the destination well
        # isn't it, the cell itself can't go there - regardless of whether anything else
        # currently sits in that well. Without this direct check, a cell whose destination
        # box happens to have no other *open* resident right now (never yet opened, or
        # gone fully terminal) would fall through to the in-place branch below and have
        # its CellUse.well silently rewritten outside its own tray box, leaving it (and
        # the grid's derived tray card for it) permanently out of sync with home_well.
        if cell.home_well is not None and cell.home_well != well:
            reassign_to_new_cell = True
        else:
            # Cells created via bootstrap_cell() (the one-time historical cutover tool)
            # have no tray/home_well at all, so they fall back to this box-collision
            # check instead: eager tray-of-4 population means a brand-new tray auto-opens
            # all 4 sibling wells the moment any one of them gets a sample, and an older,
            # unrelated tray may already have (and later vacated) that exact well. Either
            # way, if a *different*, still-open physical cell already sits in this exact
            # (instrument, well), that cell - not the one being dragged - is the one this
            # sample must land on. Mirrors open_new_tray()'s own box-collision query.
            resident_cell_id = db.scalar(
                select(Cell.id)
                .join(Cell.tray)
                .where(
                    CellTray.instrument_id == instrument.id,
                    Cell.home_well == well,
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
            run_date=run_date,
            well=well,
            run_time_hours=run_time_hours,
            start_hour=start_hour,
            start_minute=start_minute,
            cell_choice=cell_choice,
            actor=actor,
        )

    # --- writes: same-cell reschedule ---
    dest_cycle = get_or_create_run(
        db,
        instrument=instrument,
        run_date=run_date,
        run_time_hours=run_time_hours,
        start_hour=start_hour,
        start_minute=start_minute,
    )
    if dest_cycle.movie_hours != int(run_time_hours):
        raise PlacementError(
            409,
            f"This run is already set to {dest_cycle.movie_hours}h; cannot mix a {int(run_time_hours)}h placement into it.",
        )
    if dest_cycle.status != "planned":
        raise PlacementError(409, f"Run is locked (status: {dest_cycle.status}); cannot place into it.")

    old_cycle_id = old_cycle.id
    old_run_batch = old_cycle.run_batch
    same_cycle = old_cycle_id == dest_cycle.id
    if same_cycle and cell_use.well == well:
        return dest_cycle  # no-op: dropped back onto its own slot

    cell_use.cycle = dest_cycle
    cell_use.well = well
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise PlacementError(409, f"slot already occupied: well {well} is taken on this run.")

    if not same_cycle:
        remaining = db.scalar(select(func.count()).select_from(CellUse).where(CellUse.cycle_id == old_cycle_id))
        if remaining == 0 and old_run_batch is not None:
            db.delete(old_run_batch)

    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="move_sample",
            entity_type="cell_use",
            entity_id=cell_use.id,
            details_json={
                "from_cycle_id": old_cycle_id,
                "to_cycle_id": dest_cycle.id,
                "well": well,
                "instrument_serial": instrument_serial,
                "run_date": run_date.isoformat(),
            },
        )
    )
    db.commit()
    db.refresh(dest_cycle)
    return dest_cycle


def _move_sample_to_new_cell(
    db: Session,
    *,
    cell_use: CellUse,
    old_cycle: Cycle,
    instrument: Instrument,
    run_date: date,
    well: str,
    run_time_hours: float,
    start_hour: int,
    start_minute: int,
    cell_choice: dict | None,
    actor: str | None,
) -> Cycle:
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
            f"cell_choice is required to move this sample to well {well}.",
        )

    dest_cycle = get_or_create_run(
        db,
        instrument=instrument,
        run_date=run_date,
        run_time_hours=run_time_hours,
        start_hour=start_hour,
        start_minute=start_minute,
    )
    if dest_cycle.movie_hours != int(run_time_hours):
        raise PlacementError(
            409,
            f"This run is already set to {dest_cycle.movie_hours}h; cannot mix a {int(run_time_hours)}h placement into it.",
        )
    if dest_cycle.status != "planned":
        raise PlacementError(409, f"Run is locked (status: {dest_cycle.status}); cannot place into it.")

    barcodes = cell_use.barcode_list
    new_cell = _resolve_cell_choice(
        db,
        cell_choice,
        instrument_id=instrument.id,
        instrument_serial=instrument.serial_number,
        well=well,
        barcodes=barcodes,
        run_date=run_date,
    )

    old_cycle_id = old_cycle.id
    old_run_batch = old_cycle.run_batch

    new_cell_use = CellUse(
        cycle_id=dest_cycle.id, cell_id=new_cell.id, sample_id=cell_use.sample_id, well=well, status="planned"
    )
    db.add(new_cell_use)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise PlacementError(409, f"slot already occupied: well {well} is taken on this run.")

    for bc in barcodes:
        db.add(CellUseBarcode(cell_use_id=new_cell_use.id, barcode=bc))

    db.delete(cell_use)
    db.flush()

    remaining = db.scalar(select(func.count()).select_from(CellUse).where(CellUse.cycle_id == old_cycle_id))
    if remaining == 0 and old_run_batch is not None:
        db.delete(old_run_batch)

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
                "run_date": run_date.isoformat(),
                "from_cell_id": old_cell.id,
                "to_cell_id": new_cell.id,
            },
        )
    )
    db.commit()
    db.refresh(dest_cycle)
    return dest_cycle


def swap_samples(db: Session, *, cell_use_id_a: int, cell_use_id_b: int, actor: str | None = None) -> list[Cycle]:
    """Exchange which sample is loaded onto two already-placed CellUses - dragging a placed
    sample onto a *different* occupied slot in the weekly grid. Deliberately never touches
    cycle_id/well/cell_id on either row: only sample_id and its barcode snapshot move. So
    neither cell gains or loses a use, no use's run_date changes, and the well each cell is
    pinned to (see docs/pacbio-sprq-nx-scheduling-reference.md's "a cell can never move
    between instruments"/"must stay in its own well") is untouched on both sides - the
    3-use cap, 108h window, and the (cycle_id, well) unique constraint all stay
    structurally unaffected, with nothing left to re-validate beyond a barcode clash."""
    if cell_use_id_a == cell_use_id_b:
        raise PlacementError(400, "Cannot swap a placement with itself.")

    options = [
        selectinload(CellUse.cycle),
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
    db.refresh(use_a.cycle)
    db.refresh(use_b.cycle)
    return [use_a.cycle] if use_a.cycle.id == use_b.cycle.id else [use_a.cycle, use_b.cycle]


def cancel_run(db: Session, cycle_id: int, actor: str | None = None) -> None:
    cycle = db.get(
        Cycle,
        cycle_id,
        options=[
            selectinload(Cycle.run_batch),
            selectinload(Cycle.cell_uses).selectinload(CellUse.sample),
            selectinload(Cycle.cell_uses).selectinload(CellUse.cell),
        ],
    )
    if cycle is None:
        raise PlacementError(404, f"Cycle {cycle_id} not found.")
    if cycle.status != "planned":
        raise PlacementError(409, f"Only planned runs can be cancelled (status: {cycle.status}).")

    # Cancelled stages (a stopped cell's permanent marker - see stop_cell) are excluded
    # from what this cancels, mirroring remove_sample's own guard: they aren't a real,
    # revertable placement, and deleting one here would discard the exact "kept forever"
    # guarantee stop_cell's design intends. Only remove_sample-eligible stages are touched.
    all_uses = list(cycle.cell_uses)
    removable = [cu for cu in all_uses if cu.status != "cancelled"]
    touched_cells = {cu.cell for cu in removable if cu.cell is not None}
    reverted = 0
    for cu in removable:
        if cu.sample is not None:
            cu.sample.status = "backlog"
            reverted += 1
        db.delete(cu)  # cascades this use's own barcodes
    db.flush()

    run_batch = cycle.run_batch
    cycle_deleted = len(removable) == len(all_uses)
    if cycle_deleted:
        db.delete(cycle)
        if run_batch is not None:
            db.delete(run_batch)
    # else: a cancelled marker survives - leave the Cycle/RunBatch in place around it,
    # same as remove_sample would for a single item.
    db.flush()

    now = utcnow()
    for cell in touched_cells:
        db.refresh(cell, attribute_names=["cell_uses"])
        if cell.cell_uses:
            recompute_status(cell, now)
        elif cell.tray_id is None:
            # Same as remove_sample: a cell left with no uses at all after this cycle's
            # cell_uses were removed, and with no physical tray backing it, was only ever
            # a placeholder for this run.
            db.delete(cell)
        else:
            # A tray-linked cell is a real physical sibling even with 0 uses - stays open,
            # unless every sibling in its tray is also down to 0 uses (see remove_sample).
            cleanup_tray_if_fully_unused(db, cell)

    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="cancel_run",
            entity_type="cycle",
            entity_id=cycle_id,
            details_json={"reverted_sample_count": reverted, "cycle_deleted": cycle_deleted},
        )
    )
    db.commit()
