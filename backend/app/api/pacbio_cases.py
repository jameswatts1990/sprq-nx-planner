from fastapi import APIRouter, HTTPException, Response
from sqlalchemy.orm import selectinload

from app.api.deps import ActorDep, SessionDep
from app.models.pacbio_case import PacbioCase
from app.schemas.credit import (
    CreditActorRequest,
    CreditConfirmRequest,
    CreditInternalReportRequest,
    CreditNotesRequest,
    CreditOwnerRequest,
    CreditReportToPacbioRequest,
)
from app.schemas.pacbio_case import PacbioCaseCreate, PacbioCaseOut, PacbioCaseUpdate
from app.services import pacbio_case_service as svc

# PacBio credit cases logged WITHOUT a RunNx cell - the QC page lists them alongside the cells'
# own cases (GET /api/cells?qc_status=in_workflow). The stage routes mirror /api/cells/{id}/...
router = APIRouter(prefix="/api/pacbio-cases", tags=["pacbio-cases"])


def _get_case(db: SessionDep, case_id: int) -> PacbioCase:
    case = db.get(PacbioCase, case_id, options=[selectinload(PacbioCase.instrument)])
    if case is None:
        raise HTTPException(404, "Case not found")
    return case


@router.get("", response_model=list[PacbioCaseOut])
def list_cases(db: SessionDep) -> list[PacbioCaseOut]:
    return svc.list_cases(db)


@router.post("", response_model=PacbioCaseOut, status_code=201)
def create_case(req: PacbioCaseCreate, db: SessionDep, actor: ActorDep) -> PacbioCaseOut:
    try:
        return svc.create_case(db, req, req.actor or actor)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.put("/{case_id}", response_model=PacbioCaseOut)
def update_case(case_id: int, req: PacbioCaseUpdate, db: SessionDep, actor: ActorDep) -> PacbioCaseOut:
    case = _get_case(db, case_id)
    try:
        return svc.update_case(db, case, req, req.actor or actor)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.delete("/{case_id}", status_code=204)
def delete_case(case_id: int, db: SessionDep, actor: ActorDep) -> Response:
    svc.delete_case(db, _get_case(db, case_id), actor)
    return Response(status_code=204)


@router.post("/{case_id}/report-to-pacbio", response_model=PacbioCaseOut)
def report_to_pacbio(case_id: int, req: CreditReportToPacbioRequest, db: SessionDep, actor: ActorDep) -> PacbioCaseOut:
    case = _get_case(db, case_id)
    try:
        return svc.report_to_pacbio(db, case, req.case_number, req.actor or actor)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/{case_id}/internal-report", response_model=PacbioCaseOut)
def set_internal_report(
    case_id: int, req: CreditInternalReportRequest, db: SessionDep, actor: ActorDep
) -> PacbioCaseOut:
    case = _get_case(db, case_id)
    try:
        return svc.set_internal_report(db, case, req.report_id, req.actor or actor)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/{case_id}/confirm-credit", response_model=PacbioCaseOut)
def confirm_credit(case_id: int, req: CreditConfirmRequest, db: SessionDep, actor: ActorDep) -> PacbioCaseOut:
    case = _get_case(db, case_id)
    try:
        return svc.confirm_credit(db, case, req.acquisitions, req.actor or actor)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/{case_id}/credit-notes", response_model=PacbioCaseOut)
def set_notes(case_id: int, req: CreditNotesRequest, db: SessionDep, actor: ActorDep) -> PacbioCaseOut:
    return svc.set_notes(db, _get_case(db, case_id), req.notes, req.actor or actor)


@router.post("/{case_id}/credit-owner", response_model=PacbioCaseOut)
def set_owner(case_id: int, req: CreditOwnerRequest, db: SessionDep, actor: ActorDep) -> PacbioCaseOut:
    case = _get_case(db, case_id)
    try:
        return svc.set_owner(db, case, req.owner, req.actor or actor)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/{case_id}/receive-credit", response_model=PacbioCaseOut)
def receive_credit(case_id: int, req: CreditActorRequest, db: SessionDep, actor: ActorDep) -> PacbioCaseOut:
    case = _get_case(db, case_id)
    try:
        return svc.receive_credit(db, case, req.actor or actor)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
