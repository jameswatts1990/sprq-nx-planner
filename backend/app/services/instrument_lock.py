"""Derives an instrument's run-lock window from its plates. A run loading a single plate
(one tray, <=4 wells) commits the instrument only for a short loading/setup window - the
operator can still walk up and load a second plate, or a different instrument's run, once it
settles (this is what enables the 4-cells/day utilisation cadence). A run with two plates
commits the instrument for the full acquisition span: for a same-day parallel run that's the
movie + buffer that day; for a reuse run (Plate 2 acquires a later day, after the on-board
wash) it stretches through Plate 2's day - which the old per-(instrument, day) model got
wrong, under-locking a reuse as two separate short windows on two RunBatches.

A locked instrument still accepts placements into an *existing* run (see
placement_service.place_sample) - only a brand-new run's start time is checked against a
prior run's lock (see get_or_create_run), so loading the next run while the current one is
sequencing is never blocked. See docs/pacbio-sprq-nx-scheduling-reference.md's "Instrument
load-lock timing" section for the vendor timing this is derived from.
"""
from __future__ import annotations

from collections.abc import Iterable
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.engine.constants import LOCK_BUFFER_HOURS
from app.models.schedule import Cycle, RunBatch
from app.timeutil import ensure_aware, utcnow

# Longest span is a reuse run: Plate 1 loaded on day D, Plate 2 acquiring ~D+1 with a 30h
# movie ending ~D+2, +6h buffer. So a run loaded up to ~3 days before a check date can still
# hold the instrument then; look back that far when scanning for an active lock.
LOOKBACK_DAYS = 3


def run_lock_until(db: Session, run_batch: RunBatch, *, cycles: Iterable[Cycle] | None = None) -> datetime:
    """When the instrument frees up after this run.

    - One plate (a single tray, <=4 wells): the short LOCK_BUFFER_HOURS loading/setup window
      from that plate's start, regardless of movie_hours - the operator can load the other
      bay or another run's tray once it settles.
    - Two plates: committed through the *last* plate's movie end plus the next run's own
      LOCK_BUFFER_HOURS setup. Both plates start the same day for a parallel run; Plate 2
      starts a later day for a reuse run, so the lock correctly spans into that day.

    Pass `cycles` (a reliably-loaded RunBatch.cycles) to read the plates in memory - only
    where the collection is known fresh (post-commit/serialization); omit it and it uses
    run_batch.cycles directly."""
    plates = list(cycles) if cycles is not None else list(run_batch.cycles)
    if not plates:
        return utcnow() + timedelta(hours=LOCK_BUFFER_HOURS)
    if len(plates) <= 1:
        return ensure_aware(plates[0].planned_start_at) + timedelta(hours=LOCK_BUFFER_HOURS)
    last_end = max(ensure_aware(c.planned_start_at) + timedelta(hours=c.movie_hours) for c in plates)
    return last_end + timedelta(hours=LOCK_BUFFER_HOURS)


def _candidate_runs(db: Session, instrument_id: int, *, on_or_before: date) -> list[RunBatch]:
    """Runs on this instrument with at least one non-terminal plate acquiring within the
    bounded lookback window ending `on_or_before`. Excludes runs whose plates are all
    aborted/completed: once a plate's real-world outcome is known, the instrument's true
    future availability follows that, not a projection from planned timing. Loads each run's
    full plate set so run_lock_until can read them in memory."""
    stmt = (
        select(RunBatch)
        .join(Cycle, Cycle.run_batch_id == RunBatch.id)
        .where(
            RunBatch.instrument_id == instrument_id,
            Cycle.acquire_date <= on_or_before,
            Cycle.acquire_date >= on_or_before - timedelta(days=LOOKBACK_DAYS),
            Cycle.status.notin_(("aborted", "completed")),
        )
        .options(selectinload(RunBatch.cycles))
    )
    return list(db.scalars(stmt).unique().all())


def latest_lock_until(db: Session, instrument_id: int, before_date: date) -> datetime | None:
    """The latest lock_until among this instrument's runs loaded strictly before before_date,
    within the bounded lookback window. Used to gate a *new* run's start time."""
    runs = [r for r in _candidate_runs(db, instrument_id, on_or_before=before_date) if r.load_date < before_date]
    if not runs:
        return None
    return max(run_lock_until(db, r) for r in runs)


def currently_locked_run(db: Session, instrument_id: int, at: datetime | None = None) -> RunBatch | None:
    """The run (if any) whose [earliest plate start, lock_until) window contains `at` -
    _candidate_runs already excludes runs stopped early (aborted) or already completed."""
    at = at or utcnow()
    active: list[tuple[datetime, RunBatch]] = []
    for run in _candidate_runs(db, instrument_id, on_or_before=at.date()):
        starts = [ensure_aware(c.planned_start_at) for c in run.cycles]
        if starts and min(starts) <= at < run_lock_until(db, run, cycles=run.cycles):
            active.append((min(starts), run))
    if not active:
        return None
    return max(active, key=lambda pair: pair[0])[1]
