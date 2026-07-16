"""Derives an instrument's run-lock window from its Cycle's own columns plus how many
wells are currently loaded onto it. Loading only tray 1 (<=4 wells) only commits the
instrument for a short loading/setup window; loading tray 2 as well commits it for the
full movie. See docs/pacbio-sprq-nx-scheduling-reference.md's "Instrument load-lock
timing" section for the vendor timing this is derived from.

A locked instrument still accepts placements into an *existing* run (see
placement_service.place_sample) - only a brand-new run's start time is checked against
a prior run's lock (see placement_service.get_or_create_run), so loading the next run's
cells while the current one is sequencing is never blocked."""
from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.engine.constants import LOCK_BUFFER_HOURS, WELLS
from app.models.schedule import CellUse, Cycle, RunBatch
from app.timeutil import ensure_aware, utcnow

# Longest possible lock span is 30h movie + 6h buffer = 36h. A run starting late in one
# day can therefore still be locked two calendar days later, so look back that far.
LOOKBACK_DAYS = 2

# Wells belonging to tray 2 (see WELLS: tray 1 is indices 0-3, tray 2 is 4-7). Loading
# any of these onto a cycle is what commits the instrument for the full movie instead of
# just the short loading window - see cycle_lock_until.
TRAY_2_WELLS = frozenset(WELLS[4:])


def _tray2_loaded(db: Session, cycle_id: int) -> bool:
    """Queried directly against CellUse (never through the Cycle.cell_uses relationship)
    on purpose: placement/move mid-transaction later reassigns a CellUse's cycle_id by
    raw column assignment, bypassing the ORM relationship API. If this instead populated
    Cycle.cell_uses via the relationship, that collection would go stale - at the old
    cycle's cascade-delete (once it's emptied), SQLAlchemy would still see the
    already-moved CellUse sitting in the old cycle's in-memory collection and wrongly
    delete it out from under the move."""
    return (
        db.scalar(select(CellUse.id).where(CellUse.cycle_id == cycle_id, CellUse.well.in_(TRAY_2_WELLS)).limit(1))
        is not None
    )


def cycle_lock_until(db: Session, cycle: Cycle) -> datetime:
    """Only tray 1 loaded: the instrument is free again after the LOCK_BUFFER_HOURS
    loading/setup window, regardless of movie_hours - the operator can still walk up and
    load tray 2 (or a different instrument's run) once that settles. Once tray 2 is also
    loaded, the instrument is committed to the full movie and stays locked until it
    completes plus the next run's own LOCK_BUFFER_HOURS setup."""
    start = ensure_aware(cycle.planned_start_at)
    hours = cycle.movie_hours + LOCK_BUFFER_HOURS if _tray2_loaded(db, cycle.id) else LOCK_BUFFER_HOURS
    return start + timedelta(hours=hours)


def _candidate_cycles(db: Session, instrument_id: int, *, on_or_before: date) -> list[Cycle]:
    """Excludes "aborted"/"completed" cycles: once a cycle's real-world outcome is known
    (the operator has confirmed it one way or the other), the instrument's true future
    availability should follow that known outcome rather than a hypothetical projection
    from planned_start_at + movie_hours - there's nothing left to project. Only
    planned/running cycles have a genuinely uncertain real-world end that justifies
    projecting a lock forward from planned timing."""
    stmt = (
        select(Cycle)
        .join(RunBatch, Cycle.run_batch_id == RunBatch.id)
        .where(
            RunBatch.instrument_id == instrument_id,
            RunBatch.run_date <= on_or_before,
            RunBatch.run_date >= on_or_before - timedelta(days=LOOKBACK_DAYS),
            Cycle.status.notin_(("aborted", "completed")),
        )
        .options(selectinload(Cycle.run_batch))
    )
    return list(db.scalars(stmt).unique().all())


def latest_lock_until(db: Session, instrument_id: int, before_date: date) -> datetime | None:
    """The latest lock_until among this instrument's runs strictly before before_date,
    within the bounded lookback window. Used to gate a *new* run's start time."""
    cycles = [c for c in _candidate_cycles(db, instrument_id, on_or_before=before_date) if c.run_batch.run_date < before_date]
    if not cycles:
        return None
    return max(cycle_lock_until(db, c) for c in cycles)


def currently_locked_cycle(db: Session, instrument_id: int, at: datetime | None = None) -> Cycle | None:
    """The cycle (if any) whose [planned_start_at, lock_until) window contains `at` -
    _candidate_cycles already excludes cycles that were stopped early (aborted) or already
    completed."""
    at = at or utcnow()
    cycles = _candidate_cycles(db, instrument_id, on_or_before=at.date())
    active = [c for c in cycles if ensure_aware(c.planned_start_at) <= at < cycle_lock_until(db, c)]
    if not active:
        return None
    return max(active, key=lambda c: c.planned_start_at)
