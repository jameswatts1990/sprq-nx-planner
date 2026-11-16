"""QC worklist summary: the counts behind the QC nav item's chip."""
from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.deps import SessionDep
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
