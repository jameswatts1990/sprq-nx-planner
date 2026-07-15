from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import selectinload

from app.api.deps import ActorDep, SessionDep
from app.models.schedule import CellUse, Cycle, RunBatch
from app.schemas.run import AutoFillRequest, AutoFillResponse, BarcodeConflictOut, CycleOut, GridCellRef, WindowFlagOut
from app.services.auto_fill_service import auto_fill
from app.services.placement_service import PlacementError
from app.services.run_serializer import cycle_out

router = APIRouter(prefix="/api/auto-fill", tags=["auto-fill"])

_CYCLE_OPTIONS = [
    selectinload(Cycle.run_batch).selectinload(RunBatch.instrument),
    selectinload(Cycle.cell_uses).selectinload(CellUse.cell),
    selectinload(Cycle.cell_uses).selectinload(CellUse.sample),
    selectinload(Cycle.cell_uses).selectinload(CellUse.barcodes),
]


@router.post("", response_model=AutoFillResponse)
def auto_fill_endpoint(req: AutoFillRequest, db: SessionDep, actor: ActorDep) -> AutoFillResponse:
    try:
        result = auto_fill(
            db,
            cells=req.cells,
            max_uses=req.max_uses,
            run_time_hours=req.run_time_hours,
            objective=req.objective,
            start_hour=req.start_hour,
            start_minute=req.start_minute,
            actor=actor,
        )
    except PlacementError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc

    runs: list[CycleOut] = []
    for cycle_id in result.run_cycle_ids:
        cycle = db.get(Cycle, cycle_id, options=_CYCLE_OPTIONS)
        if cycle is not None:
            runs.append(cycle_out(db, cycle))

    return AutoFillResponse(
        placed_sample_ids=result.placed_sample_ids,
        unplaced_sample_ids=result.unplaced_sample_ids,
        skipped_cells=[GridCellRef(instrument_serial=s, run_date=d) for s, d in result.skipped_cells],
        window_flags=[WindowFlagOut(cell_ref=ref, span_hours=span) for ref, span in result.window_flags],
        barcode_conflicts=[
            BarcodeConflictOut(sample_external_id_a=c.a, sample_external_id_b=c.b, shared_barcodes=c.shared)
            for c in result.barcode_conflicts
        ],
        runs=runs,
    )
