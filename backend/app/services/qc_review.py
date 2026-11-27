"""QC Review: SMRT cells the QC team failed in LangQC that RunNx has no fail mark on.

LangQC writes its verdict on every Revio well to MLWH (`pac_bio_run_well_metrics.qc_seq_state`).
A cell or instrument failure ("Failed, SMRT cell" / "Failed, Instrument") is a facility failure,
so it's a PacBio credit case, but it's decided after the run and outside RunNx, so RunNx may never
hear of it. This module reads those wells from MLWH (services/mlwh.py) and matches each one to the
RunNx run and cell use it was loaded as (Traction run name + plate + well). The ones RunNx hasn't
failed make up the QC page's QC Review queue.

Nothing is copied into RunNx: the queue is rebuilt on every read. A well leaves it as soon as:
- RunNx fails it. "Confirm fail" is the normal Cell QC Fail (qc_service.commit_qc), which labels
  the cell's case QC Review (Cell.credit_source). A fail started in RunNx does the same.
- it's logged as a case without a cell (PacbioCase.mlwh_well_key).
- it's ignored, with a reason (QcReviewIgnore). Ignored wells move to a list of their own.

Follows the pacbio-dashboard's reading of LangQC (build_dashboard._seq_hold_class):
- states are matched by shape, so a new cell-failure state LangQC adds can't slip through.
- a plain "Failed" stays out, because the sample missed its metrics; that isn't a facility failure.
- Sequel wells stay out.
- a well is keyed run|plate|well, because both plates of a Revio run label their wells A1-D1.
The query uses only columns the dashboard already reads from the live warehouse.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from app.models.pacbio_case import PacbioCase
from app.models.qc_review import QcReviewIgnore
from app.models.schedule import CellUse, RunBatch
from app.schemas.qc_review import (
    QcReviewIgnoreOut,
    QcReviewMatchOut,
    QcReviewOut,
    QcReviewWellOut,
)
from app.services import mlwh, mlwh_wells
from app.services.audit_util import log_action
from app.services.cell_service import run_has_started
from app.services.mlwh_wells import MlwhWell, RunIndex, load_runs, smrt_link_url
from app.services.run_serializer import _use_number
from app.services.settings_service import get_qc_review_lookback_days
from app.timeutil import utcnow

# The wells LangQC marked as some kind of failure since :since (by QC sign-off, falling back to the
# well's own end for a verdict with no date), oldest first like the rest of the QC worklist. The
# LIKE is only a cheap prefilter; is_facility_failure() decides. Patterns are bound parameters so no
# literal % has to survive driver paramstyle escaping.
_FLAGGED_WHERE = "m.qc_seq_state LIKE :fail_pattern AND COALESCE(m.qc_seq_date, m.well_complete, m.run_complete) >= :since"
_FLAGGED_ORDER = "COALESCE(m.qc_seq_date, m.well_complete, m.run_complete)"
# QC Review is rebuilt from MLWH at most this often; the Today page polls it every minute per tab.
_REVIEW_TTL_S = 60

# How far before the earliest flagged well's start a RunNx run is still looked at: a run is loaded
# before its wells start (cell prep alone can take over a day), and a reuse Plate 2 later still.
_RUN_LOAD_SLACK = timedelta(days=7)


def is_facility_failure(qc_state: str | None) -> bool:
    """A LangQC state that means the SMRT cell or the instrument failed. Matched by shape, as the
    pacbio-dashboard does, so a new cell/instrument failure state is never missed. A plain
    "Failed" (the sample missed its metrics) and an aborted run are not counted."""
    s = (qc_state or "").strip().lower()
    return "fail" in s and any(word in s for word in ("instrument", "smrt", "cell"))


def fetch_flagged_wells(engine: Engine, since: datetime) -> list[MlwhWell]:
    """Every Revio well LangQC failed for a SMRT-cell or instrument reason since `since` (naive,
    like MLWH's own timestamps), oldest first. Raises on any MLWH failure."""
    params = {"fail_pattern": "%fail%", "since": since.strftime("%Y-%m-%d %H:%M:%S")}
    wells = mlwh_wells.fetch_wells(engine, _FLAGGED_WHERE, params, order_by=_FLAGGED_ORDER)
    return [w for w in wells if is_facility_failure(w.qc_state)]


# Use statuses the Cell QC Fail can never act on (a finished outcome), unlike a run that just isn't
# confirmed loaded yet.
_NEVER_FAILABLE = ("completed", "aborted")


def _blocked_reason(use: CellUse) -> str | None:
    """Why the Cell QC Fail can't run on this use - the same rules qc_service._resolve_trigger
    enforces, worded for the QC Review row. None when it can."""
    cell = use.cell
    if cell is not None and cell.status == "retired":
        return "This cell is retired in RunNx, so it can't be failed - undo the retire on its cell page first."
    if use.status in _NEVER_FAILABLE:
        return f"RunNx recorded this run as {use.status}, so it can't be failed now - log a case for it instead."
    if not run_has_started(use):
        return "This run isn't confirmed loaded in RunNx yet - confirm it on the schedule first."
    return None


def _match_out(run: RunBatch, use: CellUse | None, by: str, well: MlwhWell) -> QcReviewMatchOut:
    out = QcReviewMatchOut(by=by, run_batch_id=run.id, run_label=run.run_name or f"#{run.id}")
    if use is None:
        out.blocked_reason = "RunNx has this run, but nothing in this plate and well - log a case for it instead."
        out.log_instead = True
        return out
    cell = use.cell
    pool_id = use.sample.pool_id if use.sample else None
    blocked = _blocked_reason(use)
    out.cell_use_id = use.id
    out.cell_id = cell.id if cell else None
    out.cell_code = cell.code if cell else None
    out.cell_type = cell.cell_type if cell else None
    out.cell_status = cell.status if cell else None
    out.use_number = _use_number(use)
    out.use_status = use.status
    out.sample_id = use.sample_id
    out.pool_id = pool_id
    upper_barcodes = {b.upper() for b in well.library_barcodes}
    out.pool_matches = (pool_id.strip().upper() in upper_barcodes) if pool_id and upper_barcodes else None
    out.can_fail = blocked is None
    out.blocked_reason = blocked
    out.log_instead = use.status in _NEVER_FAILABLE
    return out


def _already_failed(use: CellUse | None) -> bool:
    """RunNx already has a fail mark for this well: the use is Failed, or its cell is Stopped (a
    stop is a fail on the cell, and its credit case is already open)."""
    if use is None:
        return False
    return use.status == "failed" or (use.cell is not None and use.cell.status == "stopped")


def _well_out(well: MlwhWell, match: QcReviewMatchOut | None, ignore: QcReviewIgnore | None) -> QcReviewWellOut:
    return QcReviewWellOut(
        key=well.key,
        run_name=well.run_name,
        plate_number=well.plate_number,
        well_label=well.well_label,
        instrument_name=well.instrument_name,
        qc_state=well.qc_state,
        qc_date=well.qc_date,
        well_start=well.well_start,
        well_complete=well.well_complete,
        smrt_cell_id=well.smrt_cell_id,
        cell_lot=well.cell_lot,
        cell_use_count=well.cell_use_count,
        is_multi_use=well.is_multi_use,
        sequencing_kit=well.sequencing_kit,
        movie_name=well.movie_name,
        movie_minutes=well.movie_minutes,
        loading_conc=well.loading_conc,
        hifi_yield_gb=well.hifi_yield_gb,
        library_barcodes=well.library_barcodes,
        sample_count=well.sample_count,
        smrt_link_url=smrt_link_url(well),
        match=match,
        ignored=QcReviewIgnoreOut(reason=ignore.reason, ignored_by=ignore.ignored_by, ignored_at=ignore.ignored_at)
        if ignore
        else None,
    )


def build_review(db: Session, *, now: datetime | None = None, refresh: bool = False) -> QcReviewOut:
    """The QC Review queue as of `now`. Never raises for MLWH trouble: unset or unreachable comes
    back as configured=False / error, so the rest of the QC page is unaffected. `refresh` skips the
    cached MLWH read (the section's Retry)."""
    lookback = get_qc_review_lookback_days(db)
    since = (now or utcnow()) - timedelta(days=lookback)
    out = QcReviewOut(configured=mlwh.is_configured(), ok=False, lookback_days=lookback, since=since.date())
    if not out.configured:
        return out
    db.rollback()  # hand RunNx's connection back while MLWH is asked (see mlwh_wells)
    naive_since = since.replace(tzinfo=None)
    try:
        wells = mlwh_wells.fetch(
            ("qc_review", lookback),
            lambda engine: fetch_flagged_wells(engine, naive_since),
            ttl=_REVIEW_TTL_S,
            refresh=refresh,
        )
    except mlwh_wells.MlwhUnavailable as exc:
        out.error = str(exc)
        return out
    out.ok = True
    if not wells:
        return out

    keys = [w.key for w in wells]
    logged = set(db.scalars(select(PacbioCase.mlwh_well_key).where(PacbioCase.mlwh_well_key.in_(keys))))
    ignores = {i.mlwh_well_key: i for i in db.scalars(select(QcReviewIgnore).where(QcReviewIgnore.mlwh_well_key.in_(keys)))}
    days = [w.start_day for w in wells if w.start_day]
    index = RunIndex(load_runs(db, (min(days) if days else since.date()) - _RUN_LOAD_SLACK))

    for well in wells:
        if well.key in logged:
            out.already_logged += 1
            continue
        found = index.match(well)
        use = found[1] if found else None
        if _already_failed(use):
            out.already_failed += 1
            continue
        match = _match_out(*found, well) if found else None
        ignore = ignores.get(well.key)
        (out.ignored if ignore else out.pending).append(_well_out(well, match, ignore))
    return out


# --- Ignore / restore ---------------------------------------------------------------------

ENTITY_TYPE = "qc_review"
_KEY_MAX = 200
_REASON_MAX = 500


class AlreadyIgnored(ValueError):
    """The well is already on the Ignored list (someone else got there first)."""


def ignore_well(db: Session, key: str, reason: str, actor: str | None) -> QcReviewIgnore:
    """Move a well to the Ignored list with the lab's reason. Raises ValueError for a blank
    reason or a malformed key, AlreadyIgnored for a well that's already ignored."""
    key = (key or "").strip()
    reason = (reason or "").strip()
    if not key or len(key) > _KEY_MAX or key.count("|") != 2:
        raise ValueError("That isn't a QC Review well.")
    if not reason:
        raise ValueError("Say why this well is being ignored.")
    if len(reason) > _REASON_MAX:
        raise ValueError(f"Keep the reason to {_REASON_MAX} characters or fewer.")
    if db.scalar(select(QcReviewIgnore.id).where(QcReviewIgnore.mlwh_well_key == key)) is not None:
        raise AlreadyIgnored("This well is already ignored.")
    ignore = QcReviewIgnore(mlwh_well_key=key, reason=reason, ignored_by=actor or "unknown")
    db.add(ignore)
    db.flush()
    log_action(db, actor, "ignore_qc_review_well", ENTITY_TYPE, ignore.id, {"well": key, "reason": reason})
    db.commit()
    db.refresh(ignore)
    return ignore


def restore_well(db: Session, key: str, actor: str | None) -> None:
    """Put an ignored well back in the queue. Raises LookupError if it isn't ignored."""
    ignore = db.scalar(select(QcReviewIgnore).where(QcReviewIgnore.mlwh_well_key == (key or "").strip()))
    if ignore is None:
        raise LookupError("That well isn't on the Ignored list.")
    log_action(
        db, actor, "restore_qc_review_well", ENTITY_TYPE, ignore.id, {"well": ignore.mlwh_well_key, "reason": ignore.reason}
    )
    db.delete(ignore)
    db.commit()
