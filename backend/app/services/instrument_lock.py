"""Derives an instrument's run-lock window from its Cycle's own columns. Not stored:
planned_start_at/movie_hours are immutable once a Cycle is created, so lock_until never
goes stale relative to them.

A locked instrument still accepts placements into an *existing* run (see
placement_service.place_sample) - only a brand-new run's start time is checked against
a prior run's lock (see placement_service.get_or_create_run), so loading the next run's
cells while the current one is sequencing is never blocked."""
from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.engine.constants import LOCK_BUFFER_HOURS
from app.models.schedule import Cycle, RunBatch
from app.timeutil import ensure_aware, utcnow

# Longest possible lock span is 30h movie + 6h buffer = 36h. A run starting late in one
# day can therefore still be locked two calendar days later, so look back that far.
LOOKBACK_DAYS = 2


def cycle_lock_until(cycle: Cycle) -> datetime:
    return ensure_aware(cycle.planned_start_at) + timedelta(hours=cycle.movie_hours + LOCK_BUFFER_HOURS)


def _candidate_cycles(db: Session, instrument_id: int, *, on_or_before: date) -> list[Cycle]:
    stmt = (
        select(Cycle)
        .join(RunBatch, Cycle.run_batch_id == RunBatch.id)
        .where(
            RunBatch.instrument_id == instrument_id,
            RunBatch.run_date <= on_or_before,
            RunBatch.run_date >= on_or_before - timedelta(days=LOOKBACK_DAYS),
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
    return max(cycle_lock_until(c) for c in cycles)


def currently_locked_cycle(db: Session, instrument_id: int, at: datetime | None = None) -> Cycle | None:
    """The cycle (if any) whose [planned_start_at, lock_until) window contains `at`,
    ignoring cycles that were stopped early (aborted) or already completed."""
    at = at or utcnow()
    cycles = _candidate_cycles(db, instrument_id, on_or_before=at.date())
    active = [
        c
        for c in cycles
        if c.status not in ("aborted", "completed") and ensure_aware(c.planned_start_at) <= at < cycle_lock_until(c)
    ]
    if not active:
        return None
    return max(active, key=lambda c: c.planned_start_at)
