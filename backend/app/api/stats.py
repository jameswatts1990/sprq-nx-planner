from datetime import date

from fastapi import APIRouter

from app.api.deps import SessionDep
from app.schemas.stats import GroupBy, StatsResponse
from app.services.stats_service import compute_stats

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("", response_model=StatsResponse)
def get_stats(
    db: SessionDep,
    date_from: date | None = None,
    date_to: date | None = None,
    instrument_serial: str | None = None,
    group_by: GroupBy = "week",
) -> StatsResponse:
    """Aggregated figures for the Stats dashboard. Time-series/throughput respect the
    date range (by run load date) and instrument filter, bucketed by week, month or quarter;
    cell/sample/credit snapshots reflect current outstanding state - see
    services/stats_service.py for the scoping rules."""
    return compute_stats(db, date_from, date_to, instrument_serial, group_by)
