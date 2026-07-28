"""Serializes an Instrument into the InstrumentOut shape, attaching its current lock
state - derived the same way CycleOut's is_locked/lock_until are, via instrument_lock,
never stored on the Instrument row itself."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.instrument import Instrument
from app.schemas.instrument import InstrumentOut
from app.services.cell_timing import run_acquisition_end
from app.services.instrument_lock import currently_locked_run


def serialize_instrument(db: Session, instrument: Instrument) -> InstrumentOut:
    # is_locked / locked_until here mean "a run is acquiring on this instrument now, until when"
    # (the acquisition window - drives the Schedule's "running" badge), not the loading-lock that
    # gates a new run. currently_locked_run and run_acquisition_end share the per-cell timing
    # model with the live gantts, so badge, stats, and gantt agree.
    locked_run = currently_locked_run(db, instrument.id)
    return InstrumentOut(
        id=instrument.id,
        serial_number=instrument.serial_number,
        name=instrument.name,
        active=instrument.active,
        down_from=instrument.down_from,
        down_note=instrument.down_note,
        is_locked=locked_run is not None,
        locked_until=run_acquisition_end(locked_run) if locked_run is not None else None,
    )
