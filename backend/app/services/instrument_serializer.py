"""Serializes an Instrument into the InstrumentOut shape, attaching its current lock
state - derived the same way CycleOut's is_locked/lock_until are, via instrument_lock,
never stored on the Instrument row itself - and its downtime periods (services/downtime.py)."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.instrument import Instrument
from app.models.instrument_downtime import InstrumentDowntime
from app.schemas.instrument import DowntimeOut, InstrumentOut
from app.services import downtime
from app.services.cell_timing import run_acquisition_end
from app.services.instrument_lock import currently_locked_run


def serialize_downtime(period: InstrumentDowntime) -> DowntimeOut:
    return DowntimeOut.model_validate(period, from_attributes=True)


def serialize_instrument(db: Session, instrument: Instrument) -> InstrumentOut:
    # is_locked / locked_until here mean "a run is acquiring on this instrument now, until when"
    # (the acquisition window - drives the Schedule's "running" badge), not the loading-lock that
    # gates a new run. currently_locked_run and run_acquisition_end share the per-cell timing
    # model with the live gantts, so badge, stats, and gantt agree.
    locked_run = currently_locked_run(db, instrument.id)
    current, upcoming = downtime.current_and_next(instrument.downtimes, downtime.today())
    shown = current or upcoming
    return InstrumentOut(
        id=instrument.id,
        serial_number=instrument.serial_number,
        name=instrument.name,
        location=instrument.location,
        asset_number=instrument.asset_number,
        active=instrument.active,
        downtimes=[serialize_downtime(p) for p in instrument.downtimes],
        down_now=current is not None,
        next_downtime=serialize_downtime(upcoming) if upcoming is not None else None,
        down_from=shown.start_date if shown is not None else None,
        down_note=shown.note if shown is not None else None,
        is_locked=locked_run is not None,
        locked_until=run_acquisition_end(locked_run) if locked_run is not None else None,
    )
