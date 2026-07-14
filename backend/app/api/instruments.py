from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.api.deps import SessionDep
from app.models.instrument import Instrument
from app.schemas.instrument import InstrumentCreate, InstrumentOut, InstrumentUpdate
from app.services.instrument_serializer import serialize_instrument

router = APIRouter(prefix="/api/instruments", tags=["instruments"])


@router.get("", response_model=list[InstrumentOut])
def list_instruments(db: SessionDep, active_only: bool = False) -> list[InstrumentOut]:
    stmt = select(Instrument).order_by(Instrument.serial_number)
    if active_only:
        stmt = stmt.where(Instrument.active.is_(True))
    return [serialize_instrument(db, i) for i in db.scalars(stmt).all()]


@router.post("", response_model=InstrumentOut, status_code=201)
def create_instrument(req: InstrumentCreate, db: SessionDep) -> InstrumentOut:
    existing = db.scalar(select(Instrument).where(Instrument.serial_number == req.serial_number))
    if existing is not None:
        raise HTTPException(409, f"Instrument '{req.serial_number}' already exists")
    instrument = Instrument(serial_number=req.serial_number, name=req.name, active=req.active)
    db.add(instrument)
    db.commit()
    db.refresh(instrument)
    return serialize_instrument(db, instrument)


@router.patch("/{instrument_id}", response_model=InstrumentOut)
def update_instrument(instrument_id: int, req: InstrumentUpdate, db: SessionDep) -> InstrumentOut:
    instrument = db.get(Instrument, instrument_id)
    if instrument is None:
        raise HTTPException(404, "Instrument not found")
    if req.name is not None:
        instrument.name = req.name
    if req.active is not None:
        instrument.active = req.active
    db.commit()
    db.refresh(instrument)
    return serialize_instrument(db, instrument)
