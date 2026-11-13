from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

DowntimeKind = Literal["planned", "unplanned"]


class DowntimeOut(BaseModel):
    """One out-of-service period (models/instrument_downtime.py). end_date is the LAST down day
    (inclusive); None = open-ended, down until brought back online."""

    id: int
    start_date: date
    end_date: date | None
    kind: DowntimeKind
    note: str | None
    created_by: str | None
    created_at: datetime


class InstrumentOut(BaseModel):
    id: int
    serial_number: str
    name: str | None
    location: str | None
    asset_number: str | None
    active: bool
    # Downtime periods, oldest first (services/downtime.py holds the rules). down_now = a period
    # covers today (UTC); next_downtime = the first period starting after today. down_from /
    # down_note are derived from the current period, else the next one (null when neither) -
    # kept for callers that only need "down from when, and why".
    downtimes: list[DowntimeOut] = []
    down_now: bool = False
    next_downtime: DowntimeOut | None = None
    down_from: date | None = None
    down_note: str | None = None
    # Derived run-lock state (an instrument busy because a run is sequencing on it), not stored -
    # see services/instrument_serializer.py. Distinct from downtime above.
    is_locked: bool
    locked_until: datetime | None


class InstrumentCreate(BaseModel):
    serial_number: str
    name: str | None = None
    location: str | None = None
    asset_number: str | None = None
    active: bool = True


class InstrumentUpdate(BaseModel):
    name: str | None = None
    location: str | None = None
    asset_number: str | None = None
    active: bool | None = None


class InstrumentMaintenanceIn(BaseModel):
    """Body for POST /{id}/maintenance - shorthand for "down from this date until brought back
    online": an open-ended unplanned downtime period."""

    down_from: date
    note: str | None = None


class DowntimeIn(BaseModel):
    """Create or (full) replace a downtime period. end_date None = open-ended."""

    start_date: date
    end_date: date | None = None
    kind: DowntimeKind = "unplanned"
    note: str | None = None


class DowntimeEndIn(BaseModel):
    """End a period: the instrument is usable again from back_online_on (default today), so its
    last down day becomes the day before."""

    back_online_on: date | None = None


class AffectedRunOut(BaseModel):
    """A run with a plate acquiring inside a downtime period - listed when the period is saved,
    never moved. plates = which of its plates (1/2) acquire inside it."""

    run_id: int
    load_date: date
    run_name: str | None
    status: str
    plates: list[int]


class DowntimeWriteOut(BaseModel):
    """What a period create/edit/end returns: the period (None once an end removed it), the
    refreshed instrument, and the runs already booked inside it."""

    downtime: DowntimeOut | None
    instrument: InstrumentOut
    affected_runs: list[AffectedRunOut] = []


class InstrumentStatsOut(BaseModel):
    """At-a-glance per-instrument figures for the Instruments management tab. Computed in
    services/instrument_stats.py (Python roll-up, lab-sized data)."""

    id: int
    serial_number: str
    running_run_name: str | None
    # The id of the run behind running_run_name, so the Instruments card can link the headline
    # straight to that run's History detail page. None when nothing is acquiring right now.
    running_run_id: int | None
    free_at: datetime | None
    open_tray_count: int
    cell_open_count: int
    cell_total_count: int
    last_run_date: date | None
    total_runs: int
    next_run_date: date | None
    # Live instrument state right now (services/cell_timing.instrument_activity): how many
    # resident cells are in each phase, and whether the instrument is prep-locked (a fresh load
    # can't start while cells are still breaking out). Capacity facts: sequencing <= 4, in_ppa
    # <= 2. See docs/pacbio-sprq-nx-scheduling-reference.md, "Per-cell breakout, PPA capacity...".
    cells_awaiting_prep: int = 0
    cells_prepping: int = 0
    cells_sequencing: int = 0
    cells_in_ppa: int = 0
    prep_locked: bool = False
