"""Response shape for GET /api/stats - the aggregated figures behind the Stats page.

Grouped to mirror the dashboard sections (throughput, reuse, failures, inventory,
availability) plus a flat headline block for the KPI tiles. All aggregation lives in
services/stats_service.py; nothing here computes anything.

Note on scoping (kept consistent with the Help copy): the time-series and throughput
figures respect the date-range/instrument filters; the "now" snapshots - cell status,
sample funnel, and the PacBio credit funnel - describe current outstanding state and are
not date-filtered (a credit still owed doesn't stop mattering because it fell outside the
window).

Runs are counted by their derived status (run_serializer.run_status - a running run whose last
cell is through analysis reads completed, since nothing in the lab workflow marks a run
completed) and bucketed by their load date; every series point's `period` is the first day of
its week (Monday), month or quarter, per the request's group_by."""
from datetime import date
from typing import Literal

from pydantic import BaseModel

GroupBy = Literal["week", "month", "quarter"]


# --- Throughput & run rate ---
class PeriodPoint(BaseModel):
    period: date
    runs_completed: int
    samples_sequenced: int  # wells on completed runs that didn't fail or abort
    planned_runs: int  # runs loading in the period that are still planned (not confirmed loaded)


class InstrumentThroughput(BaseModel):
    serial: str
    name: str | None
    runs_completed: int
    samples_sequenced: int


class MovieHoursSlice(BaseModel):
    movie_hours: int
    count: int  # wells loaded with this movie time


class ThroughputStats(BaseModel):
    series: list[PeriodPoint]
    per_instrument: list[InstrumentThroughput]
    movie_hours_mix: list[MovieHoursSlice]


# --- Reuse & utilisation ---
class DepthSlice(BaseModel):
    uses: int  # 1, 2 or 3
    cells: int


class AvgUsesPoint(BaseModel):
    period: date
    avg_uses: float


class PlateFillPoint(BaseModel):
    period: date
    filled: int  # wells used on loaded runs
    capacity: int  # 4 wells x plates loaded (a run of 1 plate holds 4, of 2 plates 8)


class WindowWaste(BaseModel):
    full_3_uses: int  # terminal cells that got all 3 uses out of the 108h window
    expired_early: int  # terminal cells whose window lapsed before all 3 uses were spent


class ReuseStats(BaseModel):
    depth_distribution: list[DepthSlice]
    avg_uses_trend: list[AvgUsesPoint]
    plate_fill: list[PlateFillPoint]
    window_waste: WindowWaste


# --- Failures & credits ---
class OutcomeSlice(BaseModel):
    status: str  # completed | failed | aborted
    count: int  # wells on loaded runs with that outcome


class FailureRatePoint(BaseModel):
    period: date
    failed: int
    total: int  # wells loaded in the period (on runs no longer planned)


class CreditFunnel(BaseModel):
    # Counts every PacBio credit case: failed/stopped cells' own cases + cases logged without a cell.
    needs_report: int  # not yet raised with PacBio
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
    period: date
    imported: int


class InventoryStats(BaseModel):
    cell_status: list[StatusSlice]
    sample_funnel: list[StatusSlice]
    import_volume: list[ImportVolumePoint]


# --- Instrument availability ---
class InstrumentAvailability(BaseModel):
    """Weekdays in the range (up to today) an instrument was up vs in a downtime period. Weekdays
    only - runs load Mon-Fri, so a down weekend costs no loading capacity."""

    serial: str
    name: str | None
    weekdays: int
    planned_down: int
    unplanned_down: int
    uptime_pct: float  # 0-100, (weekdays - down) of weekdays


# --- Headline KPI tiles ---
class HeadlineStats(BaseModel):
    runs_completed: int
    samples_sequenced: int
    planned_runs: int
    avg_uses_per_cell: float
    pct_reaching_use3: float  # 0-100
    failure_rate: float  # 0-100, failed of wells loaded
    plate_fill_pct: float  # 0-100, wells used of 4 per plate loaded
    cells_awaiting_credit: int
    credits_received: int


class StatsResponse(BaseModel):
    group_by: GroupBy
    headline: HeadlineStats
    throughput: ThroughputStats
    reuse: ReuseStats
    failures: FailureStats
    inventory: InventoryStats
    availability: list[InstrumentAvailability] = []
