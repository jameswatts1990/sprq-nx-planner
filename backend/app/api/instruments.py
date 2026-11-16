from fastapi import APIRouter, HTTPException, Response
from sqlalchemy import func, select

from app.api.deps import ActorDep, SessionDep
from app.models.cell_tray import CellTray
from app.models.instrument import Instrument
from app.models.instrument_downtime import InstrumentDowntime
from app.models.schedule import RunBatch
from app.schemas.instrument import (
    AffectedRunOut,
    DowntimeEndIn,
    DowntimeIn,
    DowntimeWriteOut,
    InstrumentCreate,
    InstrumentMaintenanceIn,
    InstrumentOut,
    InstrumentStatsOut,
    InstrumentUpdate,
)
from app.services import downtime
from app.services.audit_util import diff, log_action
from app.services.instrument_serializer import serialize_downtime, serialize_instrument
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


def _get_instrument(db: SessionDep, instrument_id: int) -> Instrument:
    instrument = db.get(Instrument, instrument_id)
    if instrument is None:
        raise HTTPException(404, "Instrument not found")
    return instrument


def _get_period(instrument: Instrument, downtime_id: int) -> InstrumentDowntime:
    period = next((p for p in instrument.downtimes if p.id == downtime_id), None)
    if period is None:
        raise HTTPException(404, "Downtime not found")
    return period


def _write_out(
    db: SessionDep, instrument: Instrument, period: InstrumentDowntime | None, affected: list[AffectedRunOut]
) -> DowntimeWriteOut:
    db.commit()
    db.refresh(instrument)
    return DowntimeWriteOut(
        downtime=serialize_downtime(period) if period is not None else None,
        instrument=serialize_instrument(db, instrument),
        affected_runs=affected,
    )


@router.post("/{instrument_id}/downtimes", response_model=DowntimeWriteOut, status_code=201)
def add_downtime(instrument_id: int, req: DowntimeIn, db: SessionDep, actor: ActorDep) -> DowntimeWriteOut:
    """Add a downtime period. No new run can load on its days (placement_service gates, auto-fill
    skips); runs already booked inside it are returned as affected_runs and left where they are."""
    instrument = _get_instrument(db, instrument_id)
    try:
        period, affected = downtime.create(db, instrument, req, actor)
    except downtime.DowntimeError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc
    return _write_out(db, instrument, period, affected)


@router.put("/{instrument_id}/downtimes/{downtime_id}", response_model=DowntimeWriteOut)
def update_downtime(
    instrument_id: int, downtime_id: int, req: DowntimeIn, db: SessionDep, actor: ActorDep
) -> DowntimeWriteOut:
    """Replace a period's dates, kind and note (PUT: end_date null = open-ended, so a partial
    PATCH couldn't express clearing it). Returns the runs booked inside the new dates."""
    instrument = _get_instrument(db, instrument_id)
    period = _get_period(instrument, downtime_id)
    try:
        period, affected = downtime.update(db, instrument, period, req, actor)
    except downtime.DowntimeError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc
    return _write_out(db, instrument, period, affected)


@router.post("/{instrument_id}/downtimes/{downtime_id}/end", response_model=DowntimeWriteOut)
def end_downtime(
    instrument_id: int, downtime_id: int, req: DowntimeEndIn, db: SessionDep, actor: ActorDep
) -> DowntimeWriteOut:
    """The instrument is back online from back_online_on (default today). A period that hadn't
    started by then is removed (downtime comes back null)."""
    instrument = _get_instrument(db, instrument_id)
    period = _get_period(instrument, downtime_id)
    try:
        ended = downtime.end(db, instrument, period, req.back_online_on or downtime.today(), actor)
    except downtime.DowntimeError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc
    return _write_out(db, instrument, ended, [])


@router.delete("/{instrument_id}/downtimes/{downtime_id}", status_code=204)
def delete_downtime(instrument_id: int, downtime_id: int, db: SessionDep, actor: ActorDep) -> Response:
    instrument = _get_instrument(db, instrument_id)
    downtime.delete(db, instrument, _get_period(instrument, downtime_id), actor)
    db.commit()
    return Response(status_code=204)


@router.post("/{instrument_id}/maintenance", response_model=InstrumentOut)
def mark_instrument_down(
    instrument_id: int, req: InstrumentMaintenanceIn, db: SessionDep, actor: ActorDep
) -> InstrumentOut:
    """Shorthand: down from a date until brought back online - an open-ended unplanned period."""
    instrument = _get_instrument(db, instrument_id)
    try:
        downtime.create(db, instrument, DowntimeIn(start_date=req.down_from, note=req.note), actor)
    except downtime.DowntimeError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc
    db.commit()
    db.refresh(instrument)
    return serialize_instrument(db, instrument)


@router.post("/{instrument_id}/online", response_model=InstrumentOut)
def mark_instrument_online(instrument_id: int, db: SessionDep, actor: ActorDep) -> InstrumentOut:
    """Shorthand: end the period covering today - the instrument takes new runs from today."""
    instrument = _get_instrument(db, instrument_id)
    try:
        downtime.bring_online(db, instrument, actor)
    except downtime.DowntimeError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc
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
