"""Checks shared by both kinds of PacBio credit case (a cell's own, and one logged without a cell)."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, select

from app.api.deps import SessionDep
from app.models.cell import Cell
from app.models.pacbio_case import PacbioCase

router = APIRouter(prefix="/api/credit", tags=["credit"])


class CaseNumberMatchOut(BaseModel):
    kind: Literal["cell", "case"]
    id: int
    # The cell code, or a no-cell case's summary - what the warning names.
    label: str


@router.get("/case-number-check", response_model=list[CaseNumberMatchOut])
def case_number_check(
    db: SessionDep,
    number: str = "",
    exclude_cell_id: int | None = None,
    exclude_case_id: int | None = None,
) -> list[CaseNumberMatchOut]:
    """Other credit cases already carrying this PacBio case number (trimmed, case-insensitive) -
    an inline warning while typing; saving still goes ahead."""
    key = number.strip().lower()
    if not key:
        return []
    cells = select(Cell.id, Cell.code).where(func.lower(func.trim(Cell.pacbio_case_number)) == key)
    if exclude_cell_id is not None:
        cells = cells.where(Cell.id != exclude_cell_id)
    cases = select(PacbioCase.id, PacbioCase.summary).where(
        func.lower(func.trim(PacbioCase.pacbio_case_number)) == key
    )
    if exclude_case_id is not None:
        cases = cases.where(PacbioCase.id != exclude_case_id)
    return [CaseNumberMatchOut(kind="cell", id=i, label=code) for i, code in db.execute(cells.limit(5))] + [
        CaseNumberMatchOut(kind="case", id=i, label=summary) for i, summary in db.execute(cases.limit(5))
    ]
