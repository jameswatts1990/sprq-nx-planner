"""Serializes an Instrument into the InstrumentOut shape, attaching its current lock
state - derived the same way CycleOut's is_locked/lock_until are, via instrument_lock,
never stored on the Instrument row itself."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.instrument import Instrument
from app.schemas.instrument import InstrumentOut
from app.services.instrument_lock import currently_locked_cycle, cycle_lock_until


def serialize_instrument(db: Session, instrument: Instrument) -> InstrumentOut:
    locked_cycle = currently_locked_cycle(db, instrument.id)
    return InstrumentOut(
        id=instrument.id,
        serial_number=instrument.serial_number,
        name=instrument.name,
        active=instrument.active,
        is_locked=locked_cycle is not None,
        locked_until=cycle_lock_until(db, locked_cycle) if locked_cycle is not None else None,
    )
