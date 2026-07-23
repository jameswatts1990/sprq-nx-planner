from datetime import date

from fastapi import APIRouter, Response

from app.api.deps import SessionDep
from app.services.schedule_export_service import build_schedule_csv

router = APIRouter(prefix="/api/schedule", tags=["schedule-export"])


@router.get("/export.csv")
def export_schedule_csv(
    db: SessionDep,
    date_from: date | None = None,
    date_to: date | None = None,
    instrument_serial: str | None = None,
) -> Response:
    """Download the scheduled grid as the lab's 56-column sequencing-tracker CSV.

    One row per scheduled well in the [date_from, date_to] window. Columns the app does
    not store are present but blank — intended for appending new rows to the Google Sheet."""
    csv_text = build_schedule_csv(db, date_from, date_to, instrument_serial)
    suffix = f"_{date_from.isoformat()}_{date_to.isoformat()}" if date_from and date_to else ""
    filename = f"schedule{suffix}.csv"
    return Response(
        content=csv_text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
