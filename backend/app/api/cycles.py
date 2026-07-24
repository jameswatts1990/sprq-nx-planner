from datetime import date, datetime

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import ActorDep, SessionDep
from app.models.instrument import Instrument
from app.models.schedule import CYCLE_STATUSES, RunBatch
from app.schemas.run import RunOut
from app.services.placement_service import PlacementError, cancel_run
from app.services.run_serializer import RUN_LOAD_OPTIONS, run_out
from app.services.run_service import update_run_status

# Path kept as /api/cycles for continuity, but each item is now a *run* (RunBatch): one
# load session holding 1-2 plates. {id} is a run id.
router = APIRouter(prefix="/api/cycles", tags=["runs"])


class RunStatusUpdate(BaseModel):
    status: str
    at: datetime | None = None
    actor: str | None = None
    # Only meaningful when locking (status="running") - see update_run_status.
    run_name: str | None = None


@router.get("", response_model=list[RunOut])
def list_runs(
    db: SessionDep,
    instrument_serial: str | None = None,
    status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[RunOut]:
    """Instrument calendar: the runs on a given machine over a load-date range."""
    stmt = select(RunBatch).options(*RUN_LOAD_OPTIONS)
    if instrument_serial:
        stmt = stmt.join(RunBatch.instrument).where(Instrument.serial_number == instrument_serial)
    if date_from:
        stmt = stmt.where(RunBatch.load_date >= date_from)
    if date_to:
        stmt = stmt.where(RunBatch.load_date <= date_to)

    runs = list(db.scalars(stmt).unique().all())
    out = [run_out(db, rb) for rb in runs]
    # `status` filters on the derived run-level status (see run_serializer._run_status).
    if status:
        out = [r for r in out if r.status == status]
    return out


@router.get("/{run_id}", response_model=RunOut)
def get_run(run_id: int, db: SessionDep) -> RunOut:
    run_batch = db.get(RunBatch, run_id, options=RUN_LOAD_OPTIONS)
    if run_batch is None:
        raise HTTPException(404, "Run not found")
    return run_out(db, run_batch)


@router.patch("/{run_id}", response_model=RunOut)
def patch_run(run_id: int, req: RunStatusUpdate, db: SessionDep, actor: ActorDep) -> RunOut:
    if req.status not in CYCLE_STATUSES:
        raise HTTPException(400, f"Unknown status '{req.status}'. Valid: {', '.join(CYCLE_STATUSES)}")
    run_batch = db.get(RunBatch, run_id, options=RUN_LOAD_OPTIONS)
    if run_batch is None:
        raise HTTPException(404, "Run not found")
    try:
        run_batch = update_run_status(db, run_batch, req.status, req.at, req.actor or actor, req.run_name)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    run_batch = db.get(RunBatch, run_id, options=RUN_LOAD_OPTIONS)
    return run_out(db, run_batch)


@router.post("/{run_id}/cancel", status_code=204)
def cancel_run_endpoint(run_id: int, db: SessionDep, actor: ActorDep) -> Response:
    try:
        cancel_run(db, run_id, actor)
    except PlacementError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc
    return Response(status_code=204)
