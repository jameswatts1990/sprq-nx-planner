from datetime import date, datetime

from pydantic import BaseModel


class InstrumentOut(BaseModel):
    id: int
    serial_number: str
    name: str | None
    active: bool
    # "Down for maintenance" state (see models/instrument.py). down_from is the date it went
    # down (None = online); the frontend derives is_down = down_from is not None.
    down_from: date | None
    down_note: str | None
    # Derived run-lock state (an instrument busy because a run is sequencing on it), not stored -
    # see services/instrument_serializer.py. Distinct from the maintenance-down flag above.
    is_locked: bool
    locked_until: datetime | None


class InstrumentCreate(BaseModel):
    serial_number: str
    name: str | None = None
    active: bool = True


class InstrumentUpdate(BaseModel):
    name: str | None = None
    active: bool | None = None


class InstrumentMaintenanceIn(BaseModel):
    """Body for POST /{id}/maintenance - a dedicated action rather than PATCH, because the
    'None means don't touch' PATCH convention can't express clearing a field (bringing an
    instrument back online clears down_from via the separate /online action)."""

    down_from: date
    note: str | None = None


class InstrumentStatsOut(BaseModel):
    """At-a-glance per-instrument figures for the Instruments management tab. Computed in
    services/instrument_stats.py (Python roll-up, lab-sized data)."""

    id: int
    serial_number: str
    running_run_name: str | None
    free_at: datetime | None
    open_tray_count: int
    cell_open_count: int
    cell_total_count: int
    last_run_date: date | None
    total_runs: int
    next_run_date: date | None
