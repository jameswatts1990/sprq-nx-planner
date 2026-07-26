from datetime import datetime

from typing import Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import selectinload

from app.api.deps import ActorDep, SessionDep
from app.models.audit import AuditLog
from app.models.schedule import CELL_USE_STATUSES, CellUse, RunBatch
from app.schemas.run import MoveSampleRequest, PlaceSampleRequest, RunOut
from app.services.placement_service import (
    PlacementError,
    move_sample,
    place_sample,
    remove_sample,
    remove_samples,
    return_cancelled_use_to_backlog,
    swap_samples,
    update_cell_use_run_time,
)
from app.services.run_serializer import RUN_LOAD_OPTIONS, run_out
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


class BulkRemoveRequest(BaseModel):
    cell_use_ids: list[int]


class CellUseNotesUpdate(BaseModel):
    # Empty/whitespace-only clears the note back to null; anything else is stored trimmed.
    notes: str | None = None


class CellUseRunTimeUpdate(BaseModel):
    run_time_hours: Literal[12, 24, 30]


def _cell_use_dict(cu: CellUse) -> dict:
    return {
        "id": cu.id,
        "cycle_id": cu.cycle_id,
        "cell_id": cu.cell_id,
        "cell_code": cu.cell.code if cu.cell else None,
        "sample_id": cu.sample_id,
        "sample_external_id": cu.sample.external_id if cu.sample else None,
        "well": cu.well,
        "run_time_hours": cu.run_time_hours,
        "status": cu.status,
        "barcodes": cu.barcode_list,
        "outcome_notes": cu.outcome_notes,
        "notes": cu.notes,
        "started_at": cu.started_at,
        "completed_at": cu.completed_at,
    }


@router.post("", response_model=RunOut, status_code=201)
def create_cell_use(req: PlaceSampleRequest, db: SessionDep, actor: ActorDep) -> RunOut:
    try:
        run_batch = place_sample(
            db,
            sample_id=req.sample_id,
            instrument_serial=req.instrument_serial,
            load_date=req.load_date,
            slot_index=req.slot_index,
            cell_choice=req.cell_choice.model_dump() if req.cell_choice is not None else None,
            run_time_hours=req.run_time_hours,
            start_hour=req.start_hour,
            start_minute=req.start_minute,
            actor=actor,
        )
    except PlacementError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc
    run_batch = db.get(RunBatch, run_batch.id, options=RUN_LOAD_OPTIONS)
    return run_out(db, run_batch)


@router.post("/{cell_use_id}/move", response_model=RunOut)
def move_cell_use(cell_use_id: int, req: MoveSampleRequest, db: SessionDep, actor: ActorDep) -> RunOut:
    try:
        run_batch = move_sample(
            db,
            cell_use_id=cell_use_id,
            instrument_serial=req.instrument_serial,
            load_date=req.load_date,
            slot_index=req.slot_index,
            run_time_hours=req.run_time_hours,
            start_hour=req.start_hour,
            start_minute=req.start_minute,
            cell_choice=req.cell_choice.model_dump() if req.cell_choice is not None else None,
            actor=actor,
        )
    except PlacementError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc
    run_batch = db.get(RunBatch, run_batch.id, options=RUN_LOAD_OPTIONS)
    return run_out(db, run_batch)


@router.post("/{cell_use_id}/swap", response_model=list[RunOut])
def swap_cell_use(cell_use_id: int, req: SwapCellUsesRequest, db: SessionDep, actor: ActorDep) -> list[RunOut]:
    try:
        runs = swap_samples(db, cell_use_id_a=cell_use_id, cell_use_id_b=req.other_cell_use_id, actor=actor)
    except PlacementError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc
    refreshed = [db.get(RunBatch, rb.id, options=RUN_LOAD_OPTIONS) for rb in runs]
    return [run_out(db, rb) for rb in refreshed]


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


@router.patch("/{cell_use_id}/notes")
def patch_cell_use_notes(cell_use_id: int, req: CellUseNotesUpdate, db: SessionDep, actor: ActorDep) -> dict:
    """Set/clear the free-text note on a placement. Deliberately not gated by the owning
    cycle's lock: a note stays editable after the run is confirmed/loaded, unlike the
    placement itself. Blank input clears the note."""
    cu = db.get(CellUse, cell_use_id, options=_OPTIONS)
    if cu is None:
        raise HTTPException(404, "Cell use not found")
    trimmed = (req.notes or "").strip()
    cu.notes = trimmed or None
    db.add(AuditLog(actor=actor, action="update_cell_use_notes", entity_type="cell_use", entity_id=cu.id, details_json={}))
    db.commit()
    db.refresh(cu)
    return _cell_use_dict(cu)


@router.patch("/{cell_use_id}/run-time", response_model=RunOut)
def patch_cell_use_run_time(cell_use_id: int, req: CellUseRunTimeUpdate, db: SessionDep, actor: ActorDep) -> RunOut:
    """Change one well's own movie / run time (12/24/30 h) from the slot-detail popover.
    Returns the owning run's refreshed RunOut so the grid reflects the new representative
    run time / planned end. 409 if the run is locked or this placement isn't planned."""
    try:
        run_batch = update_cell_use_run_time(db, cell_use_id=cell_use_id, run_time_hours=req.run_time_hours, actor=actor)
    except PlacementError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc
    run_batch = db.get(RunBatch, run_batch.id, options=RUN_LOAD_OPTIONS)
    return run_out(db, run_batch)


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


@router.post("/bulk-remove")
def bulk_remove_cell_uses(req: BulkRemoveRequest, db: SessionDep, actor: ActorDep) -> dict:
    """Atomically remove many placements in one transaction - the "Clear schedule" and
    multi-select "Remove from schedule" actions. Unlike firing one DELETE per stage
    concurrently, this can't race the empty-plate cleanup and strand an orphaned cycle (a
    stale instrument lock). Skips any id that can't be removed rather than failing the batch;
    the response lists what was removed and why anything was skipped."""
    removed, failures = remove_samples(db, req.cell_use_ids, actor)
    return {
        "removed_count": len(removed),
        "removed_ids": removed,
        "failed": [{"cell_use_id": cid, "reason": reason} for cid, reason in failures],
    }


@router.post("/{cell_use_id}/return-to-backlog")
def return_to_backlog(cell_use_id: int, db: SessionDep, actor: ActorDep) -> dict:
    """Recover a cancelled ("Blocked") slot left behind by a cell discard: delete the dead
    placement and put its sample back in the backlog. 409 if the block came from a Stop cell
    (a permanent QC marker - use Undo stop instead) rather than a discard."""
    try:
        sample_id = return_cancelled_use_to_backlog(db, cell_use_id, actor)
    except PlacementError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc
    return {"sample_id": sample_id}
