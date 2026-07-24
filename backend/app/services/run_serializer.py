"""Serializes a persisted RunBatch (one run) into the RunOut shape the frontend grid
renders: a run with 1-2 plates (its Cycles), each plate holding its wells (stages).

Was schedule_service.py -> the flat per-cycle cycle_out; the Run->Plate split means a run
is a RunBatch (load_date) and a plate is a Cycle (acquire_date), so we serialize the run
and nest its plates.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy.orm import Session, selectinload

from app.engine.constants import CELLS_PER_TRAY, WELLS
from app.models.cell import Cell
from app.models.schedule import CellUse, Cycle, RunBatch
from app.schemas.run import PlateOut, RunOut, StageOut
from app.services.cell_service import has_failed_use, use_run_date, window_hours_elapsed
from app.services.instrument_lock import run_lock_until
from app.timeutil import ensure_aware, utcnow

# The eager-load set every run_out caller must use. From the run's cycles (plates) down to
# each stage's cell/sample/barcodes, plus each stage's cell's *full* sibling-use list and
# each sibling's cycle: _use_number() sorts a cell's uses by acquire_date (via use_run_date
# -> cycle.acquire_date), and has_failed_use() scans the cell's use statuses. Without the
# Cell.cell_uses->cycle chain both lazy-load per stage, turning one grid fetch into an N+1.
RUN_LOAD_OPTIONS = [
    selectinload(RunBatch.instrument),
    selectinload(RunBatch.cycles)
    .selectinload(Cycle.cell_uses)
    .selectinload(CellUse.cell)
    .selectinload(Cell.cell_uses)
    .selectinload(CellUse.cycle),
    selectinload(RunBatch.cycles).selectinload(Cycle.cell_uses).selectinload(CellUse.sample),
    selectinload(RunBatch.cycles).selectinload(Cycle.cell_uses).selectinload(CellUse.barcodes),
]


def _use_number(cell_use: CellUse) -> int:
    """1-based position of this cell_use among all of its cell's loads, in true
    chronological (acquire_date) order - what the Use 1/2/3 grid colour/legend refers to.
    Grouping by cell here (rather than by well/slot_index) is what lets a reused cell's
    wells share a colour. CellUse.id is only a tie-break, not the primary key: a batch
    auto-fill spanning multiple instruments can commit rows in an order that doesn't
    match any one cell's own date sequence (see auto_fill_service.py's persist loop)."""
    cell = cell_use.cell
    if cell is None:
        return 1
    ordered = sorted(cell.cell_uses, key=lambda cu: (use_run_date(cu) or date.min, cu.id))
    return ordered.index(cell_use) + 1


def _slot_index(plate_index: int, well: str) -> int:
    """Grid position 0-7 for a well within a run: (plate - 1) * 4 + the well's letter index
    (A/B/C/D -> 0-3). Derived from the plate rather than WELLS.index(well) so a reuse Plate 2
    - whose wells are the same A01-D01 as Plate 1 - lands in the Plate 2 block (4-7), not on
    top of Plate 1."""
    within = WELLS.index(well) % CELLS_PER_TRAY if well in WELLS else 0
    return (plate_index - 1) * CELLS_PER_TRAY + within


def _stage_out(cell_use: CellUse, plate_index: int) -> StageOut:
    return StageOut(
        slot_index=_slot_index(plate_index, cell_use.well),
        well=cell_use.well,
        cell_use_id=cell_use.id,
        cell_id=cell_use.cell_id,
        cell_ref=cell_use.cell.code if cell_use.cell else "?",
        use_number=_use_number(cell_use),
        run_time_hours=cell_use.run_time_hours,
        sample_id=cell_use.sample_id,
        sample_external_id=cell_use.sample.external_id if cell_use.sample else None,
        barcodes=cell_use.barcode_list,
        cell_use_status=cell_use.status,
        cell_status=cell_use.cell.status if cell_use.cell else "open",
        cell_has_failed_use=has_failed_use(cell_use.cell) if cell_use.cell else False,
        tray_position=cell_use.cell.tray_position if cell_use.cell else None,
        tray_id=cell_use.cell.tray_id if cell_use.cell else None,
        window_hours_elapsed=window_hours_elapsed(cell_use.cell) if cell_use.cell else None,
        notes=cell_use.notes,
    )


def _plate_out(run_batch: RunBatch, cycle: Cycle) -> PlateOut:
    return PlateOut(
        plate_id=cycle.id,
        plate_index=cycle.plate_index,
        acquire_date=cycle.acquire_date,
        # A plate reuses Plate 1's cells iff it acquires later than the run's load day; a
        # fresh parallel Plate 2 acquires on the load day, same as Plate 1.
        is_reuse=cycle.acquire_date > run_batch.load_date,
        movie_hours=cycle.movie_hours,
        status=cycle.status,
        planned_start_at=cycle.planned_start_at,
        planned_end_at=cycle.planned_end_at,
        actual_start_at=cycle.actual_start_at,
        actual_end_at=cycle.actual_end_at,
        stages=[_stage_out(cu, cycle.plate_index) for cu in sorted(cycle.cell_uses, key=lambda x: x.well)],
    )


def _run_status(cycles: list[Cycle]) -> str:
    """Run-level status derived from its plates. The plates are all loaded in one session,
    so the run reads as running once any plate is, and completed only once all plates are
    terminal."""
    statuses = [c.status for c in cycles]
    if any(s == "running" for s in statuses):
        return "running"
    if statuses and all(s in ("completed", "aborted") for s in statuses):
        return "completed" if any(s == "completed" for s in statuses) else "aborted"
    return "planned"


def run_out(db: Session, run_batch: RunBatch) -> RunOut:
    instrument = run_batch.instrument
    serial = instrument.serial_number if instrument else "?"
    cycles = sorted(run_batch.cycles, key=lambda c: c.plate_index)

    plates = [_plate_out(run_batch, c) for c in cycles]
    status = _run_status(cycles)

    lock_until = run_lock_until(db, run_batch, cycles=cycles)
    now = utcnow()
    earliest_start = min((ensure_aware(c.planned_start_at) for c in cycles), default=now)
    is_locked = status not in ("aborted", "completed") and earliest_start <= now < lock_until

    return RunOut(
        run_id=run_batch.id,
        instrument_serial=serial,
        load_date=run_batch.load_date,
        run_name=run_batch.run_name,
        status=status,
        lock_until=lock_until,
        is_locked=is_locked,
        plates=plates,
    )
