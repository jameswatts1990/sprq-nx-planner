from datetime import date

from fastapi import APIRouter, Query

from app.api.deps import SessionDep
from app.schemas.batch_sheet import BatchSheetOut
from app.services.batch_sheet_service import get_batch_sheet

router = APIRouter(prefix="/api/batch-sheet", tags=["batch-sheet"])


@router.get("", response_model=BatchSheetOut)
def read_batch_sheet(
    db: SessionDep,
    load_date: date,
    instrument_serial: list[str] | None = Query(default=None),
) -> BatchSheetOut:
    """Printable load-day sheet: one section per run loaded on load_date, covering both
    plates and every well (cell + sample + settings). Omit instrument_serial to include
    every instrument with a run loaded that day."""
    return get_batch_sheet(db, load_date, instrument_serial)
