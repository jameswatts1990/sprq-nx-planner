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

from app.engine.constants import CELL_MAX_USES, DAY_START_HOUR, WELLS
from app.models.audit import AuditLog
from app.models.cell import Cell
from app.models.instrument import Instrument
from app.models.sample import Sample
from app.models.schedule import CellUse, CellUseBarcode, Cycle, RunBatch
from app.services import instrument_lock
from app.services.cell_service import current_location, derive_cell_state, recompute_status
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
        cell_id = cell_choice.get("cell_id")
        if cell_id is None:
            raise PlacementError(400, "cell_choice.cell_id is required when mode is 'existing'.")
        existing_cell = db.get(Cell, cell_id, options=[selectinload(Cell.cell_uses).selectinload(CellUse.barcodes)])
        if existing_cell is None:
            raise PlacementError(404, f"Cell {cell_id} not found.")
        if existing_cell.status != "open":
            raise PlacementError(409, f"Cell {existing_cell.code} is not open (status: {existing_cell.status}).")
        _consumed, remaining, burned = derive_cell_state(existing_cell)
        if remaining <= 0:
            raise PlacementError(409, f"Cell {existing_cell.code} has no remaining uses.")
        if any(bc in set(burned) for bc in sample_barcodes):
            raise PlacementError(409, f"barcode conflict: sample shares a burned barcode with cell {existing_cell.code}.")
        current_serial, _current_well = current_location(existing_cell)
        if current_serial is not None and current_serial != instrument_serial:
            raise PlacementError(
                409,
                f"Cell {existing_cell.code} is already in use on instrument {current_serial}; "
                f"cannot place it on {instrument_serial}.",
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
        cell = Cell(code="PENDING", max_uses=CELL_MAX_USES, status="open")
        db.add(cell)
        db.flush()
        cell.code = f"CELL-{cell.id:06d}"
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

    cell = cell_use.cell
    cycle_id = cycle.id
    run_batch = cycle.run_batch

    if cell_use.sample is not None:
        cell_use.sample.status = "backlog"

    db.delete(cell_use)
    db.flush()

    remaining = db.scalar(select(func.count()).select_from(CellUse).where(CellUse.cycle_id == cycle_id))
    if remaining == 0 and run_batch is not None:
        # frees the run_time_hours choice for that grid cell again
        db.delete(run_batch)

    if cell is not None:
        db.refresh(cell, attribute_names=["cell_uses"])
        if cell.cell_uses:
            recompute_status(cell, utcnow())
        else:
            # This cell had no other uses - it was only a placeholder for the use we just
            # removed, so nothing physical was ever loaded. Leaving it behind would produce
            # an orphan "open, 0/3" cell that can never legitimately exist.
            db.delete(cell)

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
    actor: str | None = None,
) -> Cycle:
    """Move an existing placement to a different (instrument, day, slot) in one atomic
    step - an in-place update of the CellUse's cycle/well, never a delete+recreate. That
    avoids two real problems a client-side remove-then-place has: a rejected re-place
    leaving the sample stranded in backlog with the old slot already gone, and the old
    cell being deleted (as an emptied placeholder) out from under a move that intended to
    reuse it."""
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

    cell = cell_use.cell
    other_uses = [cu for cu in cell.cell_uses if cu.id != cell_use.id and cu.status != "cancelled"]
    if other_uses:
        last_other = max(other_uses, key=lambda cu: cu.id)
        last_run_batch = last_other.cycle.run_batch if last_other.cycle else None
        pinned_serial = last_run_batch.instrument.serial_number if last_run_batch and last_run_batch.instrument else None
        if pinned_serial is not None and pinned_serial != instrument_serial:
            raise PlacementError(
                409,
                f"Cell {cell.code} is already in use on instrument {pinned_serial}; "
                f"cannot move it to {instrument_serial}.",
            )

    instrument = db.scalar(select(Instrument).where(Instrument.serial_number == instrument_serial))
    if instrument is None:
        raise PlacementError(400, f"Unknown instrument serial '{instrument_serial}'.")

    # --- writes ---
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

    cell_use.cycle_id = dest_cycle.id
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

    touched_cells = {cu.cell for cu in cycle.cell_uses if cu.cell is not None}
    reverted = 0
    for cu in cycle.cell_uses:
        if cu.sample is not None:
            cu.sample.status = "backlog"
            reverted += 1

    run_batch = cycle.run_batch
    db.delete(cycle)  # cascades cell_uses + their barcodes
    if run_batch is not None:
        db.delete(run_batch)
    db.flush()

    now = utcnow()
    for cell in touched_cells:
        db.refresh(cell, attribute_names=["cell_uses"])
        if cell.cell_uses:
            recompute_status(cell, now)
        else:
            # Same as remove_sample: a cell left with no uses at all after this cycle's
            # cell_uses cascade-deleted was only ever a placeholder for this run.
            db.delete(cell)

    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="cancel_run",
            entity_type="cycle",
            entity_id=cycle_id,
            details_json={"reverted_sample_count": reverted},
        )
    )
    db.commit()
