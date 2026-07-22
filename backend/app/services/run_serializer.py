"""Serializes a persisted Cycle (one grid run) into the CycleOut shape the frontend
grid renders. Was schedule_service.py; the Schedule-relative day_idx math is gone -
run_date now lives directly on the RunBatch."""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session, selectinload

from app.engine.constants import WELLS
from app.models.cell import Cell
from app.models.schedule import CellUse, Cycle, RunBatch
from app.schemas.run import CycleOut, StageOut
from app.services.cell_service import has_failed_use, use_run_date, window_hours_elapsed
from app.services.instrument_lock import cycle_lock_until
from app.timeutil import ensure_aware, utcnow

# The eager-load set every cycle_out caller must use. Beyond the cycle's own run_batch/
# instrument and its stages' cell/sample/barcodes, this deep-loads each stage's cell's
# *full* sibling-use list plus each sibling's cycle->run_batch: _use_number() sorts a
# cell's uses by run_date (via use_run_date -> cycle.run_batch), and has_failed_use()
# scans the cell's use statuses. Without the Cell.cell_uses->cycle->run_batch chain both
# lazy-load per stage, turning one grid fetch into an N+1 (the cells API already loads
# this same chain - see app/api/cells.py). Shared here so cycles/auto-fill/cell-uses
# endpoints can never drift out of step with what the serializer actually walks.
CYCLE_LOAD_OPTIONS = [
    selectinload(Cycle.run_batch).selectinload(RunBatch.instrument),
    selectinload(Cycle.cell_uses)
    .selectinload(CellUse.cell)
    .selectinload(Cell.cell_uses)
    .selectinload(CellUse.cycle)
    .selectinload(Cycle.run_batch),
    selectinload(Cycle.cell_uses).selectinload(CellUse.sample),
    selectinload(Cycle.cell_uses).selectinload(CellUse.barcodes),
]


def _use_number(cell_use: CellUse) -> int:
    """1-based position of this cell_use among all of its cell's loads, in true
    chronological (run_date) order - what the Use 1/2/3 grid colour/legend refers to.
    Grouping by cell here (rather than by well/slot_index) is what lets a reused cell's
    wells share a colour. CellUse.id is only a tie-break, not the primary key: a batch
    auto-fill spanning multiple instruments can commit rows in an order that doesn't
    match any one cell's own date sequence (see auto_fill_service.py's persist loop)."""
    cell = cell_use.cell
    if cell is None:
        return 1
    ordered = sorted(cell.cell_uses, key=lambda cu: (use_run_date(cu) or date.min, cu.id))
    return ordered.index(cell_use) + 1


def cycle_out(db: Session, cycle: Cycle) -> CycleOut:
    run_batch = cycle.run_batch
    instrument = run_batch.instrument if run_batch else None
    serial = instrument.serial_number if instrument else "?"

    stages = [
        StageOut(
            slot_index=WELLS.index(cu.well) if cu.well in WELLS else 0,
            well=cu.well,
            cell_use_id=cu.id,
            cell_id=cu.cell_id,
            cell_ref=cu.cell.code if cu.cell else "?",
            use_number=_use_number(cu),
            sample_id=cu.sample_id,
            sample_external_id=cu.sample.external_id if cu.sample else None,
            barcodes=cu.barcode_list,
            cell_use_status=cu.status,
            cell_status=cu.cell.status if cu.cell else "open",
            cell_has_failed_use=has_failed_use(cu.cell) if cu.cell else False,
            tray_position=cu.cell.tray_position if cu.cell else None,
            tray_id=cu.cell.tray_id if cu.cell else None,
            window_hours_elapsed=window_hours_elapsed(cu.cell) if cu.cell else None,
        )
        for cu in sorted(cycle.cell_uses, key=lambda x: x.well)
    ]

    # cycle.cell_uses is always freshly eager-loaded before cycle_out runs (every caller
    # loads via CYCLE_LOAD_OPTIONS / refreshes post-commit), so the both-trays check can
    # read it in memory instead of re-querying CellUse twice per cycle.
    lock_until = cycle_lock_until(db, cycle, cell_uses=cycle.cell_uses)
    now = utcnow()
    is_locked = cycle.status not in ("aborted", "completed") and ensure_aware(cycle.planned_start_at) <= now < lock_until

    return CycleOut(
        cycle_id=cycle.id,
        instrument_serial=serial,
        run_date=run_batch.run_date,
        movie_hours=cycle.movie_hours,
        status=cycle.status,
        run_name=cycle.run_name,
        planned_start_at=cycle.planned_start_at,
        planned_end_at=cycle.planned_end_at,
        actual_start_at=cycle.actual_start_at,
        actual_end_at=cycle.actual_end_at,
        lock_until=lock_until,
        is_locked=is_locked,
        stages=stages,
    )
