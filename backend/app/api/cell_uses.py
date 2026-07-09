from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import selectinload

from app.api.deps import ActorDep, SessionDep
from app.models.schedule import CELL_USE_STATUSES, CellUse
from app.services.run_service import update_cell_use_status

router = APIRouter(prefix="/api/cell-uses", tags=["cell-uses"])

_OPTIONS = [selectinload(CellUse.cell), selectinload(CellUse.sample), selectinload(CellUse.barcodes)]


class CellUseStatusUpdate(BaseModel):
    status: str
    at: datetime | None = None
    notes: str | None = None
    actor: str | None = None


def _cell_use_dict(cu: CellUse) -> dict:
    return {
        "id": cu.id,
        "cycle_id": cu.cycle_id,
        "cell_id": cu.cell_id,
        "cell_code": cu.cell.code if cu.cell else None,
        "sample_id": cu.sample_id,
        "sample_external_id": cu.sample.external_id if cu.sample else None,
        "use_index": cu.use_index,
        "well": cu.well,
        "status": cu.status,
        "barcodes": cu.barcode_list,
        "outcome_notes": cu.outcome_notes,
        "started_at": cu.started_at,
        "completed_at": cu.completed_at,
    }


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
    cu = update_cell_use_status(db, cu, req.status, req.at, req.notes, req.actor or actor)
    return _cell_use_dict(cu)
