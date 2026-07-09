from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import ActorDep, SessionDep
from app.models.cell import CELL_STATUSES, Cell
from app.models.schedule import CellUse, Cycle, RunBatch
from app.schemas.cell import CellBootstrapRequest, CellDetailOut, CellOut
from app.schemas.common import Page
from app.services.cell_service import bootstrap_cell, retire_cell, serialize_cell, serialize_cell_detail

router = APIRouter(prefix="/api/cells", tags=["cells"])

_LIST_OPTIONS = [
    selectinload(Cell.cell_uses).selectinload(CellUse.cycle).selectinload(Cycle.run_batch).selectinload(
        RunBatch.instrument
    ),
]
_DETAIL_OPTIONS = [
    *_LIST_OPTIONS,
    selectinload(Cell.cell_uses).selectinload(CellUse.sample),
    selectinload(Cell.cell_uses).selectinload(CellUse.barcodes),
]


@router.get("", response_model=Page[CellOut])
def list_cells(
    db: SessionDep,
    status: str | None = None,
    instrument_serial: str | None = None,
    q: str | None = None,
    page: int = 1,
    page_size: int = 50,
) -> Page[CellOut]:
    stmt = select(Cell).options(*_DETAIL_OPTIONS)
    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        for s in statuses:
            if s not in CELL_STATUSES:
                raise HTTPException(400, f"Unknown status '{s}'. Valid: {', '.join(CELL_STATUSES)}")
        stmt = stmt.where(Cell.status.in_(statuses))
    if q:
        stmt = stmt.where(Cell.code.ilike(f"%{q}%"))

    cells = list(db.scalars(stmt.order_by(Cell.created_at.desc())).unique().all())
    serialized = [serialize_cell(c) for c in cells]
    if instrument_serial:
        serialized = [c for c in serialized if c.current_instrument_serial == instrument_serial]

    total = len(serialized)
    start = (page - 1) * page_size
    return Page[CellOut](items=serialized[start : start + page_size], total=total)


@router.get("/{cell_id}", response_model=CellDetailOut)
def get_cell(cell_id: int, db: SessionDep) -> CellDetailOut:
    cell = db.get(Cell, cell_id, options=_DETAIL_OPTIONS)
    if cell is None:
        raise HTTPException(404, "Cell not found")
    return serialize_cell_detail(cell)


@router.post("/bootstrap", response_model=CellDetailOut, status_code=201)
def bootstrap_cell_endpoint(req: CellBootstrapRequest, db: SessionDep, actor: ActorDep) -> CellDetailOut:
    req = req.model_copy(update={"actor": req.actor or actor})
    try:
        cell = bootstrap_cell(db, req)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    db.refresh(cell, attribute_names=["cell_uses"])
    full = db.get(Cell, cell.id, options=_DETAIL_OPTIONS)
    return serialize_cell_detail(full)


@router.post("/{cell_id}/retire", response_model=CellOut)
def retire_cell_endpoint(cell_id: int, db: SessionDep, actor: ActorDep) -> CellOut:
    cell = db.get(Cell, cell_id, options=_DETAIL_OPTIONS)
    if cell is None:
        raise HTTPException(404, "Cell not found")
    try:
        cell = retire_cell(db, cell, actor)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return serialize_cell(cell)
