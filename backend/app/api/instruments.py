from fastapi import APIRouter, HTTPException, Response
from sqlalchemy import func, select

from app.api.deps import ActorDep, SessionDep
from app.models.cell_tray import CellTray
from app.models.instrument import Instrument
from app.models.schedule import RunBatch
from app.schemas.instrument import (
    InstrumentCreate,
    InstrumentMaintenanceIn,
    InstrumentOut,
    InstrumentStatsOut,
    InstrumentUpdate,
)
from app.services.audit_util import diff, log_action
from app.services.instrument_serializer import serialize_instrument
from app.services.instrument_stats import instrument_stats

router = APIRouter(prefix="/api/instruments", tags=["instruments"])


def _audit_snapshot(instrument: Instrument) -> dict:
    """The fields the Instruments page edits, as the audit trail records them."""
    return {
        "serial_number": instrument.serial_number,
        "name": instrument.name,
        "location": instrument.location,
        "asset_number": instrument.asset_number,
        "active": instrument.active,
    }


@router.get("", response_model=list[InstrumentOut])
def list_instruments(db: SessionDep, active_only: bool = False) -> list[InstrumentOut]:
    stmt = select(Instrument).order_by(Instrument.serial_number)
    if active_only:
        stmt = stmt.where(Instrument.active.is_(True))
    return [serialize_instrument(db, i) for i in db.scalars(stmt).all()]


@router.get("/stats", response_model=list[InstrumentStatsOut])
def list_instrument_stats(db: SessionDep) -> list[InstrumentStatsOut]:
    return instrument_stats(db)


@router.post("", response_model=InstrumentOut, status_code=201)
def create_instrument(req: InstrumentCreate, db: SessionDep, actor: ActorDep) -> InstrumentOut:
    existing = db.scalar(select(Instrument).where(Instrument.serial_number == req.serial_number))
    if existing is not None:
        raise HTTPException(409, f"Instrument '{req.serial_number}' already exists")
    instrument = Instrument(
        serial_number=req.serial_number,
        name=(req.name or "").strip() or None,
        location=(req.location or "").strip() or None,
        asset_number=(req.asset_number or "").strip() or None,
        active=req.active,
    )
    db.add(instrument)
    db.flush()
    log_action(db, actor, "instrument_create", "instrument", instrument.id, _audit_snapshot(instrument))
    db.commit()
    db.refresh(instrument)
    return serialize_instrument(db, instrument)


@router.patch("/{instrument_id}", response_model=InstrumentOut)
def update_instrument(instrument_id: int, req: InstrumentUpdate, db: SessionDep, actor: ActorDep) -> InstrumentOut:
    instrument = db.get(Instrument, instrument_id)
    if instrument is None:
        raise HTTPException(404, "Instrument not found")
    before = _audit_snapshot(instrument)
    if req.name is not None:
        # Normalize blank/whitespace to NULL so a name can be cleared back to "show the serial"
        # (an empty string would otherwise linger as a falsy-but-set name).
        instrument.name = req.name.strip() or None
    if req.location is not None:
        instrument.location = req.location.strip() or None
    if req.asset_number is not None:
        instrument.asset_number = req.asset_number.strip() or None
    if req.active is not None:
        instrument.active = req.active
    changes = diff(before, _audit_snapshot(instrument))
    if changes:
        log_action(db, actor, "instrument_update", "instrument", instrument.id, changes)
    db.commit()
    db.refresh(instrument)
    return serialize_instrument(db, instrument)


@router.post("/{instrument_id}/maintenance", response_model=InstrumentOut)
def mark_instrument_down(
    instrument_id: int, req: InstrumentMaintenanceIn, db: SessionDep, actor: ActorDep
) -> InstrumentOut:
    """Mark an instrument down for maintenance from a date. It stays visible in the schedule
    but is greyed from down_from onward and refuses new runs from that date (see
    placement_service.get_or_create_run). A dedicated action, not PATCH, so the field can also
    be cleared (via /online) - PATCH's "None means don't touch" can't express clearing."""
    instrument = db.get(Instrument, instrument_id)
    if instrument is None:
        raise HTTPException(404, "Instrument not found")
    instrument.down_from = req.down_from
    instrument.down_note = req.note
    log_action(db, actor, "instrument_down", "instrument", instrument.id, {"down_from": req.down_from.isoformat(), "note": req.note})
    db.commit()
    db.refresh(instrument)
    return serialize_instrument(db, instrument)


@router.post("/{instrument_id}/online", response_model=InstrumentOut)
def mark_instrument_online(instrument_id: int, db: SessionDep, actor: ActorDep) -> InstrumentOut:
    """Bring an instrument back online: clears the maintenance-down flag so its schedule row
    is live again."""
    instrument = db.get(Instrument, instrument_id)
    if instrument is None:
        raise HTTPException(404, "Instrument not found")
    instrument.down_from = None
    instrument.down_note = None
    log_action(db, actor, "instrument_online", "instrument", instrument.id, {})
    db.commit()
    db.refresh(instrument)
    return serialize_instrument(db, instrument)


@router.delete("/{instrument_id}", status_code=204)
def delete_instrument(instrument_id: int, db: SessionDep, actor: ActorDep) -> Response:
    """Hard-delete an instrument that has no run or tray history (e.g. one added by mistake).
    An instrument with history can't be cleanly removed - its runs/trays reference it with no
    cascade - so this refuses with a 409 pointing the user at 'mark inactive' (PATCH
    active=false) instead."""
    instrument = db.get(Instrument, instrument_id)
    if instrument is None:
        raise HTTPException(404, "Instrument not found")

    run_count = db.scalar(select(func.count()).select_from(RunBatch).where(RunBatch.instrument_id == instrument_id)) or 0
    tray_count = (
        db.scalar(select(func.count()).select_from(CellTray).where(CellTray.instrument_id == instrument_id)) or 0
    )
    if run_count or tray_count:
        raise HTTPException(
            409,
            f"Instrument {instrument.serial_number} has {run_count} run(s) and {tray_count} tray(s) - "
            "mark it inactive instead of deleting.",
        )

    log_action(db, actor, "instrument_delete", "instrument", instrument.id, {"serial_number": instrument.serial_number})
    db.delete(instrument)
    db.commit()
    return Response(status_code=204)
