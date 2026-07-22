"""Response shape for GET /api/stats - the aggregated figures behind the Stats page.

Grouped to mirror the four dashboard sections (throughput, reuse, failures, inventory)
plus a flat headline block for the KPI tiles. All aggregation lives in
services/stats_service.py; nothing here computes anything.

Note on scoping (kept consistent with the Help copy): the time-series and throughput
figures respect the date-range/instrument filters; the "now" snapshots - cell status,
sample funnel, and the PacBio credit funnel - describe current outstanding state and are
not date-filtered (a credit still owed doesn't stop mattering because it fell outside the
window)."""
from datetime import date

from pydantic import BaseModel


# --- Throughput & run rate ---
class WeekPoint(BaseModel):
    week: date  # Monday of the ISO week the figures fall in
    runs: int
    samples: int


class InstrumentThroughput(BaseModel):
    serial: str
    name: str | None
    runs: int
    cell_uses: int


class MovieHoursSlice(BaseModel):
    movie_hours: int
    count: int


class ThroughputStats(BaseModel):
    series: list[WeekPoint]
    per_instrument: list[InstrumentThroughput]
    movie_hours_mix: list[MovieHoursSlice]


# --- Reuse & utilisation ---
class DepthSlice(BaseModel):
    uses: int  # 1, 2 or 3
    cells: int


class AvgUsesPoint(BaseModel):
    week: date
    avg_uses: float


class WellFillPoint(BaseModel):
    week: date
    filled: int
    capacity: int  # runs that week * 8 wells


class WindowWaste(BaseModel):
    full_3_uses: int  # terminal cells that got all 3 uses out of the 108h window
    expired_early: int  # terminal cells whose window lapsed before all 3 uses were spent


class ReuseStats(BaseModel):
    depth_distribution: list[DepthSlice]
    avg_uses_trend: list[AvgUsesPoint]
    well_fill: list[WellFillPoint]
    window_waste: WindowWaste


# --- Failures & credits ---
class OutcomeSlice(BaseModel):
    status: str  # completed | failed | aborted
    count: int


class FailureRatePoint(BaseModel):
    week: date
    failed: int
    total: int  # completed + failed + aborted (uses that got a real verdict)


class CreditFunnel(BaseModel):
    needs_report: int  # failed/stopped cell, not yet raised with PacBio
    reported: int  # ever raised with PacBio
    awaiting: int  # raised, credit not yet received
    received: int  # credit landed


class FailureStats(BaseModel):
    outcomes: list[OutcomeSlice]
    failure_rate_trend: list[FailureRatePoint]
    credit_funnel: CreditFunnel


# --- Inventory & backlog ---
class StatusSlice(BaseModel):
    status: str
    count: int


class ImportVolumePoint(BaseModel):
    week: date
    imported: int


class InventoryStats(BaseModel):
    cell_status: list[StatusSlice]
    sample_funnel: list[StatusSlice]
    import_volume: list[ImportVolumePoint]


# --- Headline KPI tiles ---
class HeadlineStats(BaseModel):
    runs_completed: int
    samples_completed: int
    avg_uses_per_cell: float
    pct_reaching_use3: float  # 0-100
    failure_rate: float  # 0-100
    well_fill_pct: float  # 0-100
    cells_awaiting_credit: int
    credits_received: int


class StatsResponse(BaseModel):
    headline: HeadlineStats
    throughput: ThroughputStats
    reuse: ReuseStats
    failures: FailureStats
    inventory: InventoryStats
