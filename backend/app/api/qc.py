"""QC worklist: the counts behind the QC nav item's chip, and the QC Review queue (SMRT cells the
QC team failed in LangQC/MLWH that RunNx hasn't failed - services/qc_review.py)."""
from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from app.api.deps import ActorDep, SessionDep
from app.schemas.qc_review import (
    QcReviewIgnoreOut,
    QcReviewIgnoreRequest,
    QcReviewOut,
    QcReviewRestoreRequest,
)
from app.services import qc_review
from app.services.qc_summary import compute_qc_summary

router = APIRouter(prefix="/api/qc", tags=["qc"])


class QcSummaryOut(BaseModel):
    needs_report: int
    awaiting_credit: int
    overdue: int
    total_action: int


@router.get("/summary", response_model=QcSummaryOut)
def read_qc_summary(db: SessionDep) -> QcSummaryOut:
    return QcSummaryOut(**asdict(compute_qc_summary(db)))


@router.get("/review", response_model=QcReviewOut)
def read_qc_review(db: SessionDep, refresh: bool = False) -> QcReviewOut:
    """Always a 200: MLWH unset or unreachable is reported in the body (configured / error), so
    the page can say so without the rest of the QC page failing. `refresh` (the section's Retry)
    asks MLWH again instead of using the last minute's answer."""
    return qc_review.build_review(db, refresh=refresh)


@router.post("/review/ignore", response_model=QcReviewIgnoreOut, status_code=201)
def ignore_qc_review_well(req: QcReviewIgnoreRequest, db: SessionDep, actor: ActorDep) -> QcReviewIgnoreOut:
    try:
        ignore = qc_review.ignore_well(db, req.key, req.reason, req.actor or actor)
    except qc_review.AlreadyIgnored as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return QcReviewIgnoreOut(reason=ignore.reason, ignored_by=ignore.ignored_by, ignored_at=ignore.ignored_at)


@router.post("/review/restore", status_code=204)
def restore_qc_review_well(req: QcReviewRestoreRequest, db: SessionDep, actor: ActorDep) -> Response:
    try:
        qc_review.restore_well(db, req.key, req.actor or actor)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    return Response(status_code=204)
