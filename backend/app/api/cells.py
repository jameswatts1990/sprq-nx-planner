from datetime import datetime

from fastapi import APIRouter, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import ActorDep, SessionDep
from app.models.cell import CELL_STATUSES, Cell
from app.models.cell_tray import CellTray
from app.models.instrument import Instrument
from app.models.sample import Sample
from app.models.schedule import CellUse, CellUseBarcode, Cycle, RunBatch
from app.schemas.cell import (
    CellActorRequest,
    CellBootstrapRequest,
    CellDetailOut,
    CellOut,
    CellReportToPacbioRequest,
    CellStopRequest,
    TrayDiscardOut,
    TrayDiscardRequest,
    TrayRotateOut,
    TrayRotateRequest,
)
from app.schemas.common import Page
from app.schemas.qc import QcCommitOut, QcCommitRequest, QcPreviewOut, QcPreviewRequest, QcUndoOut
from app.services.cell_service import (
    bootstrap_cell,
    confirm_cell_credit,
    discard_cell,
    discard_tray,
    receive_cell_credit,
    report_cell_to_pacbio,
    rotate_tray,
    serialize_cell,
    serialize_cell_detail,
)
from app.services.qc_service import commit_qc, preview_qc, undo_qc

QC_STATUSES = ("unreported", "awaiting_credit")

router = APIRouter(prefix="/api/cells", tags=["cells"])

# Everything serialize_cell() reads: each use's cycle->run_batch->instrument (for
# current_location/last_use_run_date/first_use_planned_start_at), its barcodes (burned set),
# its sample (for the card's linked container-id list, cell_use_summary), and the cell's own
# tray->instrument (for a zero-use sibling's location).
_LIST_OPTIONS = [
    selectinload(Cell.cell_uses).selectinload(CellUse.cycle).selectinload(Cycle.run_batch).selectinload(
        RunBatch.instrument
    ),
    selectinload(Cell.cell_uses).selectinload(CellUse.barcodes),
    selectinload(Cell.cell_uses).selectinload(CellUse.sample),
    selectinload(Cell.tray).selectinload(CellTray.instrument),
]
# Detail needs the same relationships loaded; serialize_cell_detail's history renders the
# same underlying use rows just with more per-use fields, so the option set is identical.
_DETAIL_OPTIONS = list(_LIST_OPTIONS)


@router.get("", response_model=Page[CellOut])
def list_cells(
    db: SessionDep,
    status: str | None = None,
    instrument_serial: str | None = None,
    qc_status: str | None = None,
    q: str | None = None,
    tray_id: int | None = None,
    as_of: datetime | None = None,
    page: int = 1,
    page_size: int = 50,
) -> Page[CellOut]:
    # `as_of` requests a read-only projection of every time-derived field to that instant
    # (the Cells page's Now / End-of-week toggle). The status filter must then run on the
    # *projected* status, not the persisted one, so it's applied post-serialize below - the
    # persisted DB-level status filter only applies to the default "now" (as_of=None) path.
    stmt = select(Cell).options(*_LIST_OPTIONS)
    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        for s in statuses:
            if s not in CELL_STATUSES:
                raise HTTPException(400, f"Unknown status '{s}'. Valid: {', '.join(CELL_STATUSES)}")
        if as_of is None:
            stmt = stmt.where(Cell.status.in_(statuses))
    if qc_status and qc_status not in QC_STATUSES:
        raise HTTPException(400, f"Unknown qc_status '{qc_status}'. Valid: {', '.join(QC_STATUSES)}")
    if q:
        # Search any id associated with a cell, not just its own code: its tray, and - via
        # its uses - the container id (sample external id), burned barcodes, run name/id, and
        # the instrument it ran on. So typing a container id, a Traction run id, or a barcode
        # finds every cell that touched it, the same box that finds a cell code or "T123".
        term = q.strip()
        like = f"%{term}%"
        conditions = [
            Cell.code.ilike(like),
            Cell.cell_uses.any(CellUse.sample.has(Sample.external_id.ilike(like))),
            Cell.cell_uses.any(CellUse.barcodes.any(CellUseBarcode.barcode.ilike(like))),
            Cell.cell_uses.any(
                CellUse.cycle.has(Cycle.run_batch.has(RunBatch.run_name.ilike(like)))
            ),
            Cell.cell_uses.any(
                CellUse.cycle.has(
                    Cycle.run_batch.has(RunBatch.instrument.has(Instrument.serial_number.ilike(like)))
                )
            ),
        ]
        # Numeric-id shortcuts: "T123"/"123" -> tray id; "#45"/"45" -> run (RunBatch) id.
        tray_token = term[1:] if term[:1] in ("t", "T") else term
        if tray_token.isdigit():
            conditions.append(Cell.tray_id == int(tray_token))
        run_token = term[1:] if term[:1] == "#" else term
        if run_token.isdigit():
            conditions.append(
                Cell.cell_uses.any(CellUse.cycle.has(Cycle.run_batch.has(RunBatch.id == int(run_token))))
            )
        stmt = stmt.where(or_(*conditions))
    if tray_id is not None:
        stmt = stmt.where(Cell.tray_id == tray_id)

    cells = list(db.scalars(stmt.order_by(Cell.created_at.desc())).unique().all())
    serialized = [serialize_cell(c, as_of=as_of) for c in cells]
    if status and as_of is not None:
        wanted = {s.strip() for s in status.split(",") if s.strip()}
        serialized = [c for c in serialized if c.status in wanted]
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


@router.post("/{cell_id}/qc/preview", response_model=QcPreviewOut)
def qc_preview_endpoint(cell_id: int, req: QcPreviewRequest, db: SessionDep) -> QcPreviewOut:
    """Read-only: report which samples a Fail / Fail-and-Stop / Retire would affect (failed,
    displaced, reassigned) without mutating anything, so the frontend can show the disposition
    step. See services/qc_service.preview_qc."""
    cell = db.get(Cell, cell_id, options=_DETAIL_OPTIONS)
    if cell is None:
        raise HTTPException(404, "Cell not found")
    try:
        return preview_qc(cell, req.verdict, req.cell_use_id)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/{cell_id}/qc/commit", response_model=QcCommitOut)
def qc_commit_endpoint(cell_id: int, req: QcCommitRequest, db: SessionDep, actor: ActorDep) -> QcCommitOut:
    """Atomically apply a QC verdict + the per-sample dispositions: mark the failed use, re-zip
    the tray's loading queue (reassign shifted cells, cancel the displaced tail), set the cell's
    terminal status, and route each lost/displaced sample to a top-up or the backlog."""
    cell = db.get(Cell, cell_id, options=_DETAIL_OPTIONS)
    if cell is None:
        raise HTTPException(404, "Cell not found")
    try:
        return commit_qc(
            db,
            cell,
            verdict=req.verdict,
            cell_use_id=req.cell_use_id,
            reason=req.reason,
            dispositions=req.dispositions,
            actor=req.actor or actor,
        )
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/{cell_id}/qc/undo", response_model=QcUndoOut)
def qc_undo_endpoint(cell_id: int, db: SessionDep, actor: ActorDep) -> QcUndoOut:
    cell = db.get(Cell, cell_id, options=_DETAIL_OPTIONS)
    if cell is None:
        raise HTTPException(404, "Cell not found")
    try:
        return undo_qc(db, cell, actor)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


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


@router.post("/rotate-tray", response_model=TrayRotateOut)
def rotate_tray_endpoint(req: TrayRotateRequest, db: SessionDep, actor: ActorDep) -> TrayRotateOut:
    cells = list(db.scalars(select(Cell).where(Cell.tray_id == req.tray_id).options(*_DETAIL_OPTIONS)).unique())
    if not cells:
        raise HTTPException(404, "Tray not found or has no cells")
    try:
        new_cells, moved_count = rotate_tray(db, cells, req.from_date, req.reason, req.actor or actor)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return TrayRotateOut(new_cells=[serialize_cell(c) for c in new_cells], moved_count=moved_count)


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
