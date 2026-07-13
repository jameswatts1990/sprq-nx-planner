"""Serializes a persisted Cycle (one grid run) into the CycleOut shape the frontend
grid renders. Was schedule_service.py; the Schedule-relative day_idx math is gone -
run_date now lives directly on the RunBatch."""
from __future__ import annotations

from app.engine.constants import WELLS
from app.models.schedule import CellUse, Cycle
from app.schemas.run import CycleOut, StageOut


def _use_number(cell_use: CellUse) -> int:
    """1-based position of this cell_use among all of its cell's loads, in chronological
    (id) order - what the Use 1/2/3 grid colour/legend refers to. Grouping by cell here
    (rather than by well/slot_index) is what lets a reused cell's wells share a colour."""
    cell = cell_use.cell
    if cell is None:
        return 1
    ordered = sorted(cell.cell_uses, key=lambda cu: cu.id)
    return ordered.index(cell_use) + 1


def cycle_out(cycle: Cycle) -> CycleOut:
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
        )
        for cu in sorted(cycle.cell_uses, key=lambda x: x.well)
    ]

    return CycleOut(
        cycle_id=cycle.id,
        instrument_serial=serial,
        run_date=run_batch.run_date,
        movie_hours=cycle.movie_hours,
        status=cycle.status,
        planned_start_at=cycle.planned_start_at,
        planned_end_at=cycle.planned_end_at,
        actual_start_at=cycle.actual_start_at,
        actual_end_at=cycle.actual_end_at,
        stages=stages,
    )
