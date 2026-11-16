"""Instrument downtime periods (models/instrument_downtime.py): the single home of every downtime
rule, so the scheduling gates, the serializers, Stats and the Instruments page all agree.

- A period covers start_date..end_date INCLUSIVE; end_date None = open-ended (down until someone
  brings the instrument back online). Planned and unplanned gate scheduling identically - the kind
  only matters to Stats.
- Gate: no NEW run may load on a down day (placement_service.get_or_create_run / reschedule_run;
  auto_fill skips such days). Adding wells to an existing run is never blocked, and a reuse Plate 2
  that ACQUIRES on a down day is warned (PlateOut.acquires_in_downtime), never blocked.
- Creating/editing a period never moves anything: runs already booked inside it come back as
  affected_runs for the lab to deal with.
- Periods on one instrument never overlap (409), so "the period on day D" is unambiguous.

An operational lab constraint, not PacBio-documented behaviour - see
docs/pacbio-sprq-nx-scheduling-reference.md, "Instrument downtime periods"."""
from __future__ import annotations

from collections.abc import Iterable
from datetime import date, timedelta

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.models.instrument import Instrument
from app.models.instrument_downtime import InstrumentDowntime
from app.models.schedule import CellUse, Cycle, RunBatch
from app.schemas.instrument import AffectedRunOut, DowntimeIn
from app.services.audit_util import diff, log_action
from app.timeutil import utcnow

# Long enough for a real reason ("Laser swap - engineer on site Tue/Wed"), short enough for a banner.
MAX_NOTE_LEN = 500


class DowntimeError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def today() -> date:
    """The scheduling calendar is UTC dates throughout (load_date, acquire_date)."""
    return utcnow().date()


# --- pure helpers -----------------------------------------------------------------------------


def _last_day(period: InstrumentDowntime) -> date:
    return period.end_date if period.end_date is not None else date.max


def covers(period: InstrumentDowntime, day: date) -> bool:
    return period.start_date <= day <= _last_day(period)


def period_on(periods: Iterable[InstrumentDowntime], day: date) -> InstrumentDowntime | None:
    return next((p for p in periods if covers(p, day)), None)


def is_down_on(instrument: Instrument, day: date) -> bool:
    return period_on(instrument.downtimes, day) is not None


def current_and_next(
    periods: Iterable[InstrumentDowntime], on: date
) -> tuple[InstrumentDowntime | None, InstrumentDowntime | None]:
    """(the period covering `on`, the first period starting after `on`)."""
    ordered = sorted(periods, key=lambda p: p.start_date)
    current = period_on(ordered, on)
    upcoming = next((p for p in ordered if p.start_date > on), None)
    return current, upcoming


def weekdays_in(first: date, last: date) -> int:
    """Mon-Fri days in first..last inclusive (0 when last < first)."""
    if last < first:
        return 0
    days = (last - first).days + 1
    full_weeks, rest = divmod(days, 7)
    count = full_weeks * 5
    for i in range(rest):
        if (first + timedelta(days=i)).weekday() < 5:
            count += 1
    return count


def down_weekdays(periods: Iterable[InstrumentDowntime], first: date, last: date) -> dict[str, int]:
    """Weekdays in first..last inclusive that fall inside a period, split by kind. Weekdays only:
    runs only load Mon-Fri, so a down weekend costs no loading capacity."""
    out = {"planned": 0, "unplanned": 0}
    for p in periods:
        out[p.kind] += weekdays_in(max(first, p.start_date), min(last, _last_day(p)))
    return out


def _short(day: date) -> str:
    return f"{day.day} {day.strftime('%b')}"


def describe(period: InstrumentDowntime) -> str:
    """'12 Nov-14 Nov, planned' / 'from 12 Nov, unplanned' - for messages."""
    span = (
        f"from {_short(period.start_date)}"
        if period.end_date is None
        else _short(period.start_date)
        if period.end_date == period.start_date
        else f"{_short(period.start_date)}-{_short(period.end_date)}"
    )
    return f"{span}, {period.kind}"


def down_message(instrument: Instrument, day: date) -> str | None:
    """The 409 a new run on `day` gets, or None when the instrument isn't down then."""
    period = period_on(instrument.downtimes, day)
    if period is None:
        return None
    why = f": {period.note.strip().rstrip('.')}" if period.note and period.note.strip() else ""
    return (
        f"Instrument {instrument.serial_number} is down for maintenance on {day.isoformat()} "
        f"({describe(period)}){why}."
    )


# --- affected runs ----------------------------------------------------------------------------


def affected_runs(db: Session, instrument_id: int, start: date, end: date | None) -> list[AffectedRunOut]:
    """Runs on this instrument with a plate acquiring on a day in start..end (Plate 1 acquires on
    its load day; a reuse Plate 2 later). Only runs still to do or in progress (planned/running
    plates) that hold a well - a finished run, or an empty orphan plate, isn't something to act on.
    Listed for the lab; nothing here moves them."""
    stmt = (
        select(Cycle)
        .join(Cycle.run_batch)
        .where(
            RunBatch.instrument_id == instrument_id,
            Cycle.acquire_date >= start,
            Cycle.status.in_(("planned", "running")),
            exists().where(CellUse.cycle_id == Cycle.id),
        )
        .order_by(Cycle.acquire_date, RunBatch.load_date)
    )
    if end is not None:
        stmt = stmt.where(Cycle.acquire_date <= end)
    by_run: dict[int, AffectedRunOut] = {}
    for cycle in db.scalars(stmt):
        run = cycle.run_batch
        entry = by_run.setdefault(
            run.id,
            AffectedRunOut(
                run_id=run.id, load_date=run.load_date, run_name=run.run_name, status=cycle.status, plates=[]
            ),
        )
        entry.plates.append(cycle.plate_index)
        if cycle.status == "running":
            entry.status = "running"
    return list(by_run.values())


# --- writes (each adds its audit row; the caller commits) ---------------------------------------


def _snapshot(period: InstrumentDowntime) -> dict:
    return {
        "start_date": period.start_date.isoformat(),
        "end_date": period.end_date.isoformat() if period.end_date else None,
        "kind": period.kind,
        "note": period.note,
    }


def _validate(instrument: Instrument, req: DowntimeIn, exclude: InstrumentDowntime | None = None) -> str | None:
    if req.end_date is not None and req.end_date < req.start_date:
        raise DowntimeError(422, "The last down day can't be before the first.")
    note = (req.note or "").strip() or None
    if note and len(note) > MAX_NOTE_LEN:
        raise DowntimeError(422, f"Keep the reason to {MAX_NOTE_LEN} characters or fewer.")
    last = req.end_date or date.max
    for other in instrument.downtimes:
        if other is exclude:
            continue
        if other.start_date <= last and req.start_date <= _last_day(other):
            raise DowntimeError(
                409,
                f"That overlaps this instrument's downtime {describe(other)} - edit or end that one instead.",
            )
    return note


def create(
    db: Session, instrument: Instrument, req: DowntimeIn, actor: str | None
) -> tuple[InstrumentDowntime, list[AffectedRunOut]]:
    note = _validate(instrument, req)
    period = InstrumentDowntime(
        start_date=req.start_date,
        end_date=req.end_date,
        kind=req.kind,
        note=note,
        created_by=actor or "unknown",
    )
    instrument.downtimes.append(period)
    db.flush()
    log_action(
        db, actor, "instrument_downtime_add", "instrument", instrument.id, {"downtime_id": period.id, **_snapshot(period)}
    )
    return period, affected_runs(db, instrument.id, period.start_date, period.end_date)


def update(
    db: Session, instrument: Instrument, period: InstrumentDowntime, req: DowntimeIn, actor: str | None
) -> tuple[InstrumentDowntime, list[AffectedRunOut]]:
    note = _validate(instrument, req, exclude=period)
    before = _snapshot(period)
    period.start_date = req.start_date
    period.end_date = req.end_date
    period.kind = req.kind
    period.note = note
    changes = diff(before, _snapshot(period))
    if changes:
        log_action(db, actor, "instrument_downtime_update", "instrument", instrument.id, {"downtime_id": period.id, **changes})
    db.flush()
    return period, affected_runs(db, instrument.id, period.start_date, period.end_date)


def end(
    db: Session, instrument: Instrument, period: InstrumentDowntime, back_online_on: date, actor: str | None
) -> InstrumentDowntime | None:
    """The instrument is usable again from `back_online_on`: its last down day becomes the day
    before. A period that hadn't started by then is removed outright (returns None)."""
    if period.end_date is not None and back_online_on > period.end_date + timedelta(days=1):
        raise DowntimeError(
            409, f"This downtime already ends on {period.end_date.isoformat()} - edit it to extend it."
        )
    last_down = back_online_on - timedelta(days=1)
    details = {"downtime_id": period.id, "back_online_on": back_online_on.isoformat(), **_snapshot(period)}
    if last_down < period.start_date:
        instrument.downtimes.remove(period)
        log_action(db, actor, "instrument_downtime_end", "instrument", instrument.id, {**details, "removed": True})
        db.flush()
        return None
    period.end_date = last_down
    log_action(db, actor, "instrument_downtime_end", "instrument", instrument.id, details)
    db.flush()
    return period


def delete(db: Session, instrument: Instrument, period: InstrumentDowntime, actor: str | None) -> None:
    details = {"downtime_id": period.id, **_snapshot(period)}
    instrument.downtimes.remove(period)
    log_action(db, actor, "instrument_downtime_delete", "instrument", instrument.id, details)
    db.flush()


def bring_online(db: Session, instrument: Instrument, actor: str | None) -> None:
    """End whatever period covers today, back online today (the Instruments card's Bring online)."""
    current = period_on(instrument.downtimes, today())
    if current is None:
        raise DowntimeError(409, f"Instrument {instrument.serial_number} isn't down today.")
    end(db, instrument, current, today(), actor)
