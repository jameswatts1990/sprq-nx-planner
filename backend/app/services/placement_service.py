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
from app.models.instrument import Instrument
from app.models.sample import Sample
from app.models.schedule import CellUse, CellUseBarcode, Cycle, RunBatch
from app.services.cell_service import derive_cell_state, recompute_status
from app.timeutil import utcnow


class PlacementError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def planned_window(run_date: date, run_time_hours: float) -> tuple[datetime, datetime]:
    start = datetime.combine(run_date, time(hour=DAY_START_HOUR), tzinfo=timezone.utc)
    return start, start + timedelta(hours=run_time_hours)


def get_or_create_run(db: Session, *, instrument: Instrument, run_date: date, run_time_hours: float) -> Cycle:
    """Get-or-create the (instrument, run_date) RunBatch+Cycle (1:1) under the unique
    constraint. Safe against a concurrent drag into the same empty grid cell: on a losing
    INSERT race we roll back the failed insert and re-SELECT the winner's row.

    NOTE: the rollback discards the whole pending transaction, so callers must invoke this
    before making any other DB writes they care about."""

    def _existing() -> Cycle | None:
        rb = db.scalar(
            select(RunBatch)
            .where(RunBatch.instrument_id == instrument.id, RunBatch.run_date == run_date)
            .options(selectinload(RunBatch.cycles))
        )
        return rb.cycles[0] if rb is not None and rb.cycles else None

    cycle = _existing()
    if cycle is not None:
        return cycle

    run_batch = RunBatch(instrument_id=instrument.id, run_date=run_date)
    db.add(run_batch)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        cycle = _existing()
        if cycle is None:
            raise
        return cycle

    start, end = planned_window(run_date, run_time_hours)
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
    max_uses: int,
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
    elif mode != "new":
        raise PlacementError(400, f"Unknown cell_choice.mode '{mode}'.")

    # --- writes ---
    cycle = get_or_create_run(db, instrument=instrument, run_date=run_date, run_time_hours=run_time_hours)

    if cycle.movie_hours != int(run_time_hours):
        raise PlacementError(
            409,
            f"This run is already set to {cycle.movie_hours}h; cannot mix a {int(run_time_hours)}h placement into it.",
        )
    if cycle.status != "planned":
        raise PlacementError(409, f"Run is locked (status: {cycle.status}); cannot place into it.")

    if mode == "new":
        cell = Cell(code="PENDING", max_uses=max_uses, status="open")
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
        recompute_status(cell, utcnow())

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
        recompute_status(cell, now)

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
