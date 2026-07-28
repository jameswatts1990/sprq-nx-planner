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
from app.services.cell_timing import instrument_timeline, run_is_acquiring, run_load_at
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
    run_batch.cycles directly.

    Cycles with no cell_uses (orphaned empty plates a partial/racy bulk removal could leave
    behind) load nothing, so they hold the instrument for nothing and are ignored here - else
    an empty plate's planned_start would keep projecting a stale lock onto later days after a
    Clear (see run_serializer.run_out and docs/pacbio-sprq-nx-scheduling-reference.md)."""
    plates = [c for c in (list(cycles) if cycles is not None else list(run_batch.cycles)) if c.cell_uses]
    if not plates:
        return utcnow()
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
            # Ignore orphaned empty cycles - they load nothing, so they hold the instrument
            # for nothing (see run_lock_until). Without this an empty plate left by a partial
            # bulk clear would keep gating brand-new runs on later days.
            Cycle.cell_uses.any(),
        )
        .options(selectinload(RunBatch.cycles).selectinload(Cycle.cell_uses))
    )
    return list(db.scalars(stmt).unique().all())


def latest_lock_until(db: Session, instrument_id: int, before_date: date) -> datetime | None:
    """The latest lock_until among this instrument's runs loaded strictly before before_date,
    within the bounded lookback window. Used to gate a *new* run's start time."""
    runs = [r for r in _candidate_runs(db, instrument_id, on_or_before=before_date) if r.load_date < before_date]
    if not runs:
        return None
    return max(run_lock_until(db, r) for r in runs)


def effective_run_start(db: Session, run_batch: RunBatch) -> datetime | None:
    """The lane-model *effective start* of ``run_batch``: when its earliest cell actually breaks
    out once the other runs resident on its instrument are accounted for (cross-run sequencing
    contention - see cell_timing.instrument_timeline). Equals the run's own load time when the
    machine has a free sequencing server; later when it's busy. Derived per-call, never stored;
    None if nothing is loaded.

    This is the "user loads at 12:00, cells really break out at 18:00" figure surfaced as a
    placement advisory - distinct from run_lock_until (the coarse loading-lock that gates a
    brand-new load and drives grid continuation). We compute it over the same 3-day resident
    window _candidate_runs uses, plus the run itself in case it isn't already in that set."""
    resident = _candidate_runs(db, run_batch.instrument_id, on_or_before=run_batch.load_date)
    if run_batch.id not in {r.id for r in resident}:
        resident = [*resident, run_batch]
    return instrument_timeline(resident).get(run_batch.id)


def resolve_new_run_start(
    db: Session, instrument_id: int, load_date: date, requested_start: datetime
) -> datetime | None:
    """The start time a brand-new run loaded on `load_date` must actually use, given any
    prior run's instrument lock, or None if the instrument is busy for the *whole* load day
    (so the run genuinely can't be loaded then).

    The lock is a planning tool - it says when the instrument next becomes free (see the
    module docstring and docs/pacbio-sprq-nx-scheduling-reference.md's "Instrument load-lock
    timing"). A day the lock ends *on* is still a valid load day: the instrument frees up
    partway through it (e.g. a reuse run's Plate 2 movie ending at 12:00 + a 6h turnaround
    buffer frees the instrument at 18:00), so a new run can be loaded that same day - it just
    starts when the instrument is actually free, not at the earlier requested time. Only a
    lock that runs past the end of the load day (the instrument busy every hour of it) blocks
    the load outright. This is what lets a user load onto the lock-end day rather than losing
    a whole calendar day to a lock that clears mid-afternoon."""
    blocking = latest_lock_until(db, instrument_id, load_date)
    if blocking is None or requested_start >= blocking:
        return requested_start
    # The lock ends after the requested start. If it clears on the load day itself, start the
    # run when the instrument frees; if it runs into a later day, the instrument is busy all
    # of load_date and the run can't be loaded here.
    if ensure_aware(blocking).date() <= load_date:
        return blocking
    return None


def acquiring_runs(db: Session, instrument_id: int, at: datetime | None = None) -> list[RunBatch]:
    """Runs physically ACQUIRING on this instrument at ``at`` - ``at`` falls within each run's
    ``[load, last-PPA-end)`` window from the per-cell timing model (cell_timing.run_is_acquiring).
    This is "what's running right now", the single source of truth the Instruments page and the
    live gantts share.

    Distinct from the loading-lock (run_lock_until / latest_lock_until) that gates when a *new*
    run may be loaded - a single tray's loading bay frees after LOCK_BUFFER_HOURS while its cells
    keep sequencing for ~30h, so the two windows genuinely differ. _candidate_runs already drops
    aborted/completed runs and orphaned empty cycles."""
    at = at or utcnow()
    return [r for r in _candidate_runs(db, instrument_id, on_or_before=at.date()) if run_is_acquiring(r, at)]


def currently_locked_run(db: Session, instrument_id: int, at: datetime | None = None) -> RunBatch | None:
    """The run (if any) physically acquiring on this instrument at ``at`` (see acquiring_runs).
    When several overlap - a reuse plate 2 alongside a freshly-loaded new run - the latest-loaded
    one is taken as "the" current run for the single-run label/badge. Was the short loading-lock
    window; now the full acquisition window, so a run reads as running for its whole ~30h+
    sequencing+PPA span rather than only the loading-lock's first few hours."""
    active = acquiring_runs(db, instrument_id, at)
    if not active:
        return None
    return max(active, key=lambda run: run_load_at(run) or (at or utcnow()))
