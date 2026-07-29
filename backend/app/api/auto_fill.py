from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.api.deps import ActorDep, SessionDep
from app.models.sample import Sample
from app.models.schedule import RunBatch
from app.schemas.run import (
    AutoFillRequest,
    AutoFillResponse,
    BarcodeConflictOut,
    GridCellRef,
    RecalculateRequest,
    RunOut,
    WindowFlagOut,
)
from app.services.auto_fill_service import AutoFillResult, auto_fill, recalculate_instrument
from app.services.placement_service import PlacementError
from app.services.run_serializer import RUN_LOAD_OPTIONS, run_out

router = APIRouter(prefix="/api/auto-fill", tags=["auto-fill"])


def _to_response(db: SessionDep, result: AutoFillResult) -> AutoFillResponse:
    runs: list[RunOut] = []
    for run_id in result.run_ids:
        run_batch = db.get(RunBatch, run_id, options=RUN_LOAD_OPTIONS)
        if run_batch is not None:
            # with_effective_start so each auto-scheduled run carries when its cells really break
            # out given the machine's other resident runs (consecutive-day auto-fills can queue).
            runs.append(run_out(db, run_batch, with_effective_start=True))

    unplaced_external_ids: list[str] = []
    if result.unplaced_sample_ids:
        unplaced_external_ids = list(
            db.scalars(select(Sample.external_id).where(Sample.id.in_(result.unplaced_sample_ids))).all()
        )

    return AutoFillResponse(
        placed_sample_ids=result.placed_sample_ids,
        unplaced_sample_ids=result.unplaced_sample_ids,
        unplaced_external_ids=unplaced_external_ids,
        skipped_cells=[GridCellRef(instrument_serial=s, load_date=d) for s, d in result.skipped_cells],
        window_flags=[WindowFlagOut(cell_ref=ref, span_hours=span) for ref, span in result.window_flags],
        reuse_timing_flags=[
            WindowFlagOut(cell_ref=ref, span_hours=span) for ref, span in result.reuse_timing_flags
        ],
        barcode_conflicts=[
            BarcodeConflictOut(sample_external_id_a=c.a, sample_external_id_b=c.b, shared_barcodes=c.shared)
            for c in result.barcode_conflicts
        ],
        runs=runs,
        disposed_cell_ids=result.disposed_cell_ids,
        day_changed_sample_ids=result.day_changed_sample_ids,
    )


@router.post("", response_model=AutoFillResponse)
def auto_fill_endpoint(req: AutoFillRequest, db: SessionDep, actor: ActorDep) -> AutoFillResponse:
    try:
        result = auto_fill(
            db,
            cells=req.cells,
            max_uses=req.max_uses,
            movie_times=req.movie_times,
            objective=req.objective,
            cells_per_day=req.cells_per_day,
            start_hour=req.start_hour,
            start_minute=req.start_minute,
            actor=actor,
        )
    except PlacementError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc

    return _to_response(db, result)


@router.post("/recalculate", response_model=AutoFillResponse)
def recalculate_endpoint(req: RecalculateRequest, db: SessionDep, actor: ActorDep) -> AutoFillResponse:
    """"Recalculate" next to an instrument's name in the weekly grid - see
    auto_fill_service.recalculate_instrument for what it does and doesn't touch."""
    try:
        result = recalculate_instrument(db, instrument_serial=req.instrument_serial, actor=actor)
    except PlacementError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc

    return _to_response(db, result)
