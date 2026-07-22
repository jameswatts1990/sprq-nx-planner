from datetime import date, datetime

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import ActorDep, SessionDep
from app.models.instrument import Instrument
from app.models.schedule import CYCLE_STATUSES, Cycle, RunBatch
from app.schemas.run import CycleOut
from app.services.placement_service import PlacementError, cancel_run
from app.services.run_serializer import CYCLE_LOAD_OPTIONS, cycle_out
from app.services.run_service import update_cycle_status

router = APIRouter(prefix="/api/cycles", tags=["cycles"])


class CycleStatusUpdate(BaseModel):
    status: str
    at: datetime | None = None
    actor: str | None = None
    # Only meaningful when locking (status="running") - see update_cycle_status.
    run_name: str | None = None


@router.get("", response_model=list[CycleOut])
def list_cycles(
    db: SessionDep,
    instrument_serial: str | None = None,
    status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[CycleOut]:
    """Instrument calendar: the grid runs on a given machine over a date range."""
    stmt = select(Cycle).join(Cycle.run_batch).options(*CYCLE_LOAD_OPTIONS)
    if instrument_serial:
        stmt = stmt.join(RunBatch.instrument).where(Instrument.serial_number == instrument_serial)
    if status:
        stmt = stmt.where(Cycle.status == status)
    if date_from:
        stmt = stmt.where(RunBatch.run_date >= date_from)
    if date_to:
        stmt = stmt.where(RunBatch.run_date <= date_to)

    cycles = list(db.scalars(stmt).unique().all())
    return [cycle_out(db, c) for c in cycles]


@router.get("/{cycle_id}", response_model=CycleOut)
def get_cycle(cycle_id: int, db: SessionDep) -> CycleOut:
    cycle = db.get(Cycle, cycle_id, options=CYCLE_LOAD_OPTIONS)
    if cycle is None:
        raise HTTPException(404, "Cycle not found")
    return cycle_out(db, cycle)


@router.patch("/{cycle_id}", response_model=CycleOut)
def patch_cycle(cycle_id: int, req: CycleStatusUpdate, db: SessionDep, actor: ActorDep) -> CycleOut:
    if req.status not in CYCLE_STATUSES:
        raise HTTPException(400, f"Unknown status '{req.status}'. Valid: {', '.join(CYCLE_STATUSES)}")
    cycle = db.get(Cycle, cycle_id, options=CYCLE_LOAD_OPTIONS)
    if cycle is None:
        raise HTTPException(404, "Cycle not found")
    try:
        cycle = update_cycle_status(db, cycle, req.status, req.at, req.actor or actor, req.run_name)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    db.refresh(cycle, attribute_names=["cell_uses"])
    return cycle_out(db, cycle)


@router.post("/{cycle_id}/cancel", status_code=204)
def cancel_cycle(cycle_id: int, db: SessionDep, actor: ActorDep) -> Response:
    try:
        cancel_run(db, cycle_id, actor)
    except PlacementError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc
    return Response(status_code=204)
