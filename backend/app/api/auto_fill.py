from fastapi import APIRouter, HTTPException

from app.api.deps import ActorDep, SessionDep
from app.models.schedule import RunBatch
from app.schemas.run import AutoFillRequest, AutoFillResponse, BarcodeConflictOut, GridCellRef, RunOut, WindowFlagOut
from app.services.auto_fill_service import auto_fill
from app.services.placement_service import PlacementError
from app.services.run_serializer import RUN_LOAD_OPTIONS, run_out

router = APIRouter(prefix="/api/auto-fill", tags=["auto-fill"])


@router.post("", response_model=AutoFillResponse)
def auto_fill_endpoint(req: AutoFillRequest, db: SessionDep, actor: ActorDep) -> AutoFillResponse:
    try:
        result = auto_fill(
            db,
            cells=req.cells,
            max_uses=req.max_uses,
            run_time_hours=req.run_time_hours,
            objective=req.objective,
            cells_per_day=req.cells_per_day,
            start_hour=req.start_hour,
            start_minute=req.start_minute,
            actor=actor,
        )
    except PlacementError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc

    runs: list[RunOut] = []
    for run_id in result.run_ids:
        run_batch = db.get(RunBatch, run_id, options=RUN_LOAD_OPTIONS)
        if run_batch is not None:
            runs.append(run_out(db, run_batch))

    return AutoFillResponse(
        placed_sample_ids=result.placed_sample_ids,
        unplaced_sample_ids=result.unplaced_sample_ids,
        skipped_cells=[GridCellRef(instrument_serial=s, load_date=d) for s, d in result.skipped_cells],
        window_flags=[WindowFlagOut(cell_ref=ref, span_hours=span) for ref, span in result.window_flags],
        barcode_conflicts=[
            BarcodeConflictOut(sample_external_id_a=c.a, sample_external_id_b=c.b, shared_barcodes=c.shared)
            for c in result.barcode_conflicts
        ],
        runs=runs,
        disposed_cell_ids=result.disposed_cell_ids,
    )
