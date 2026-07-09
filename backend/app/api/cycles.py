from datetime import date, datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import ActorDep, SessionDep
from app.models.instrument import Instrument
from app.models.schedule import CYCLE_STATUSES, Cycle, RunBatch, Schedule
from app.schemas.schedule import CycleOut
from app.services.run_service import update_cycle_status
from app.services.schedule_service import cycle_out

router = APIRouter(prefix="/api/cycles", tags=["cycles"])

_CYCLE_OPTIONS = [
    selectinload(Cycle.run_batch).selectinload(RunBatch.schedule),
    selectinload(Cycle.run_batch).selectinload(RunBatch.instrument),
    selectinload(Cycle.cell_uses),
]


class CycleStatusUpdate(BaseModel):
    status: str
    at: datetime | None = None
    actor: str | None = None


@router.get("", response_model=list[CycleOut])
def list_cycles(
    db: SessionDep,
    instrument_serial: str | None = None,
    status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[CycleOut]:
    """Cross-schedule instrument calendar: what's on a given machine regardless of
    which committed schedule it came from."""
    stmt = select(Cycle).join(Cycle.run_batch).join(RunBatch.schedule).options(*_CYCLE_OPTIONS)
    if instrument_serial:
        stmt = stmt.join(RunBatch.instrument).where(Instrument.serial_number == instrument_serial)
    if status:
        stmt = stmt.where(Cycle.status == status)
    if date_from:
        stmt = stmt.where(Cycle.planned_start_at >= date_from)
    if date_to:
        stmt = stmt.where(Cycle.planned_start_at <= date_to)
    stmt = stmt.where(Schedule.status == "active")

    cycles = list(db.scalars(stmt).unique().all())
    return [cycle_out(c) for c in cycles]


@router.get("/{cycle_id}", response_model=CycleOut)
def get_cycle(cycle_id: int, db: SessionDep) -> CycleOut:
    cycle = db.get(Cycle, cycle_id, options=_CYCLE_OPTIONS)
    if cycle is None:
        raise HTTPException(404, "Cycle not found")
    return cycle_out(cycle)


@router.patch("/{cycle_id}", response_model=CycleOut)
def patch_cycle(cycle_id: int, req: CycleStatusUpdate, db: SessionDep, actor: ActorDep) -> CycleOut:
    if req.status not in CYCLE_STATUSES:
        raise HTTPException(400, f"Unknown status '{req.status}'. Valid: {', '.join(CYCLE_STATUSES)}")
    cycle = db.get(
        Cycle,
        cycle_id,
        options=[
            *_CYCLE_OPTIONS,
            selectinload(Cycle.cell_uses),
        ],
    )
    if cycle is None:
        raise HTTPException(404, "Cycle not found")
    cycle = update_cycle_status(db, cycle, req.status, req.at, req.actor or actor)
    db.refresh(cycle, attribute_names=["cell_uses"])
    return cycle_out(cycle)
