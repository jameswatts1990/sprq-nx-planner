from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import ActorDep, SessionDep
from app.models.cell import CELL_STATUSES, Cell
from app.models.cell_tray import CellTray
from app.models.schedule import CellUse, Cycle, RunBatch
from app.schemas.cell import (
    CellActorRequest,
    CellBootstrapRequest,
    CellDetailOut,
    CellOut,
    CellReportToPacbioRequest,
    CellStopOut,
    CellStopRequest,
    CellUndoStopOut,
    TrayDiscardOut,
    TrayDiscardRequest,
)
from app.schemas.common import Page
from app.services.cell_service import (
    bootstrap_cell,
    confirm_cell_credit,
    discard_cell,
    discard_tray,
    receive_cell_credit,
    report_cell_to_pacbio,
    retire_cell,
    serialize_cell,
    serialize_cell_detail,
    stop_cell,
    undo_stop_cell,
)

QC_STATUSES = ("unreported", "awaiting_credit")

router = APIRouter(prefix="/api/cells", tags=["cells"])

_LIST_OPTIONS = [
    selectinload(Cell.cell_uses).selectinload(CellUse.cycle).selectinload(Cycle.run_batch).selectinload(
        RunBatch.instrument
    ),
    selectinload(Cell.tray).selectinload(CellTray.instrument),
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
    qc_status: str | None = None,
    q: str | None = None,
    tray_id: int | None = None,
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
    if qc_status and qc_status not in QC_STATUSES:
        raise HTTPException(400, f"Unknown qc_status '{qc_status}'. Valid: {', '.join(QC_STATUSES)}")
    if q:
        stmt = stmt.where(Cell.code.ilike(f"%{q}%"))
    if tray_id is not None:
        stmt = stmt.where(Cell.tray_id == tray_id)

    cells = list(db.scalars(stmt.order_by(Cell.created_at.desc())).unique().all())
    serialized = [serialize_cell(c) for c in cells]
    if instrument_serial:
        serialized = [c for c in serialized if c.current_instrument_serial == instrument_serial]
    if qc_status == "unreported":
        serialized = [c for c in serialized if c.needs_qc_report]
    elif qc_status == "awaiting_credit":
        serialized = [c for c in serialized if c.awaiting_credit]
    if tray_id is not None:
        # Position order (1-4), not the list's default newest-first - "ensure the cell
        # number stays in order" for the Cell Detail page's tray sibling listing.
        serialized.sort(key=lambda c: c.tray_position or 0)

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


@router.post("/{cell_id}/stop", response_model=CellStopOut)
def stop_cell_endpoint(cell_id: int, req: CellStopRequest, db: SessionDep, actor: ActorDep) -> CellStopOut:
    cell = db.get(Cell, cell_id, options=_DETAIL_OPTIONS)
    if cell is None:
        raise HTTPException(404, "Cell not found")
    try:
        cell, bumped_sample_ids = stop_cell(db, cell, req.reason, req.actor or actor)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return CellStopOut(cell=serialize_cell(cell), bumped_sample_ids=bumped_sample_ids)


@router.post("/{cell_id}/discard", response_model=CellOut)
def discard_cell_endpoint(cell_id: int, req: CellStopRequest, db: SessionDep, actor: ActorDep) -> CellOut:
    cell = db.get(Cell, cell_id, options=_DETAIL_OPTIONS)
    if cell is None:
        raise HTTPException(404, "Cell not found")
    try:
        cell, _bumped_sample_ids = discard_cell(db, cell, req.reason, req.actor or actor)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return serialize_cell(cell)


@router.post("/discard-tray", response_model=TrayDiscardOut)
def discard_tray_endpoint(req: TrayDiscardRequest, db: SessionDep, actor: ActorDep) -> TrayDiscardOut:
    cells = list(db.scalars(select(Cell).where(Cell.tray_id == req.tray_id).options(*_DETAIL_OPTIONS)).unique())
    if not cells:
        raise HTTPException(404, "Tray not found or has no cells")
    cells = discard_tray(db, cells, req.reason, req.actor or actor)
    return TrayDiscardOut(cells=[serialize_cell(c) for c in cells])


@router.post("/{cell_id}/undo-stop", response_model=CellUndoStopOut)
def undo_stop_cell_endpoint(cell_id: int, db: SessionDep, actor: ActorDep) -> CellUndoStopOut:
    cell = db.get(Cell, cell_id, options=_DETAIL_OPTIONS)
    if cell is None:
        raise HTTPException(404, "Cell not found")
    try:
        cell, reverted_ids, drifted_ids = undo_stop_cell(db, cell, actor)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return CellUndoStopOut(cell=serialize_cell(cell), reverted_cell_use_ids=reverted_ids, drifted_cell_use_ids=drifted_ids)


@router.post("/{cell_id}/report-to-pacbio", response_model=CellOut)
def report_cell_to_pacbio_endpoint(
    cell_id: int, req: CellReportToPacbioRequest, db: SessionDep, actor: ActorDep
) -> CellOut:
    cell = db.get(Cell, cell_id, options=_DETAIL_OPTIONS)
    if cell is None:
        raise HTTPException(404, "Cell not found")
    try:
        cell = report_cell_to_pacbio(db, cell, req.case_number, req.actor or actor)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return serialize_cell(cell)


@router.post("/{cell_id}/confirm-credit", response_model=CellOut)
def confirm_cell_credit_endpoint(cell_id: int, req: CellActorRequest, db: SessionDep, actor: ActorDep) -> CellOut:
    cell = db.get(Cell, cell_id, options=_DETAIL_OPTIONS)
    if cell is None:
        raise HTTPException(404, "Cell not found")
    try:
        cell = confirm_cell_credit(db, cell, req.actor or actor)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return serialize_cell(cell)


@router.post("/{cell_id}/receive-credit", response_model=CellOut)
def receive_cell_credit_endpoint(cell_id: int, req: CellActorRequest, db: SessionDep, actor: ActorDep) -> CellOut:
    cell = db.get(Cell, cell_id, options=_DETAIL_OPTIONS)
    if cell is None:
        raise HTTPException(404, "Cell not found")
    try:
        cell = receive_cell_credit(db, cell, req.actor or actor)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return serialize_cell(cell)
