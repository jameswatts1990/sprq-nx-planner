from datetime import datetime

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import selectinload

from app.api.deps import ActorDep, SessionDep
from app.models.schedule import CELL_USE_STATUSES, CellUse, Cycle
from app.schemas.run import CycleOut, MoveSampleRequest, PlaceSampleRequest
from app.services.placement_service import PlacementError, move_sample, place_sample, remove_sample, swap_samples
from app.services.run_serializer import CYCLE_LOAD_OPTIONS, cycle_out
from app.services.run_service import undo_cell_use_status, update_cell_use_status

router = APIRouter(prefix="/api/cell-uses", tags=["cell-uses"])

_OPTIONS = [selectinload(CellUse.cell), selectinload(CellUse.sample), selectinload(CellUse.barcodes)]


class CellUseStatusUpdate(BaseModel):
    status: str
    at: datetime | None = None
    notes: str | None = None
    actor: str | None = None


class SwapCellUsesRequest(BaseModel):
    other_cell_use_id: int


def _cell_use_dict(cu: CellUse) -> dict:
    return {
        "id": cu.id,
        "cycle_id": cu.cycle_id,
        "cell_id": cu.cell_id,
        "cell_code": cu.cell.code if cu.cell else None,
        "sample_id": cu.sample_id,
        "sample_external_id": cu.sample.external_id if cu.sample else None,
        "well": cu.well,
        "status": cu.status,
        "barcodes": cu.barcode_list,
        "outcome_notes": cu.outcome_notes,
        "started_at": cu.started_at,
        "completed_at": cu.completed_at,
    }


@router.post("", response_model=CycleOut, status_code=201)
def create_cell_use(req: PlaceSampleRequest, db: SessionDep, actor: ActorDep) -> CycleOut:
    try:
        cycle = place_sample(
            db,
            sample_id=req.sample_id,
            instrument_serial=req.instrument_serial,
            run_date=req.run_date,
            slot_index=req.slot_index,
            cell_choice=req.cell_choice.model_dump(),
            run_time_hours=req.run_time_hours,
            start_hour=req.start_hour,
            start_minute=req.start_minute,
            actor=actor,
        )
    except PlacementError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc
    cycle = db.get(Cycle, cycle.id, options=CYCLE_LOAD_OPTIONS)
    return cycle_out(db, cycle)


@router.post("/{cell_use_id}/move", response_model=CycleOut)
def move_cell_use(cell_use_id: int, req: MoveSampleRequest, db: SessionDep, actor: ActorDep) -> CycleOut:
    try:
        cycle = move_sample(
            db,
            cell_use_id=cell_use_id,
            instrument_serial=req.instrument_serial,
            run_date=req.run_date,
            slot_index=req.slot_index,
            run_time_hours=req.run_time_hours,
            start_hour=req.start_hour,
            start_minute=req.start_minute,
            cell_choice=req.cell_choice.model_dump() if req.cell_choice is not None else None,
            actor=actor,
        )
    except PlacementError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc
    cycle = db.get(Cycle, cycle.id, options=CYCLE_LOAD_OPTIONS)
    return cycle_out(db, cycle)


@router.post("/{cell_use_id}/swap", response_model=list[CycleOut])
def swap_cell_use(cell_use_id: int, req: SwapCellUsesRequest, db: SessionDep, actor: ActorDep) -> list[CycleOut]:
    try:
        cycles = swap_samples(db, cell_use_id_a=cell_use_id, cell_use_id_b=req.other_cell_use_id, actor=actor)
    except PlacementError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc
    refreshed = [db.get(Cycle, c.id, options=CYCLE_LOAD_OPTIONS) for c in cycles]
    return [cycle_out(db, c) for c in refreshed]


@router.get("/{cell_use_id}")
def get_cell_use(cell_use_id: int, db: SessionDep) -> dict:
    cu = db.get(CellUse, cell_use_id, options=_OPTIONS)
    if cu is None:
        raise HTTPException(404, "Cell use not found")
    return _cell_use_dict(cu)


@router.patch("/{cell_use_id}")
def patch_cell_use(cell_use_id: int, req: CellUseStatusUpdate, db: SessionDep, actor: ActorDep) -> dict:
    if req.status not in CELL_USE_STATUSES:
        raise HTTPException(400, f"Unknown status '{req.status}'. Valid: {', '.join(CELL_USE_STATUSES)}")
    cu = db.get(CellUse, cell_use_id, options=_OPTIONS)
    if cu is None:
        raise HTTPException(404, "Cell use not found")
    try:
        cu = update_cell_use_status(db, cu, req.status, req.at, req.notes, req.actor or actor)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return _cell_use_dict(cu)


@router.post("/{cell_use_id}/undo")
def undo_cell_use(cell_use_id: int, db: SessionDep, actor: ActorDep) -> dict:
    cu = db.get(CellUse, cell_use_id, options=_OPTIONS)
    if cu is None:
        raise HTTPException(404, "Cell use not found")
    try:
        cu = undo_cell_use_status(db, cu, actor)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return _cell_use_dict(cu)


@router.delete("/{cell_use_id}", status_code=204)
def delete_cell_use(cell_use_id: int, db: SessionDep, actor: ActorDep) -> Response:
    try:
        remove_sample(db, cell_use_id, actor)
    except PlacementError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc
    return Response(status_code=204)
