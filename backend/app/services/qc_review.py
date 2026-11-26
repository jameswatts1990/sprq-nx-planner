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

import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import Engine, select, text
from sqlalchemy.orm import Session, selectinload

from app.models.cell import Cell
from app.models.pacbio_case import PacbioCase
from app.models.qc_review import QcReviewIgnore
from app.models.schedule import CellUse, Cycle, RunBatch
from app.schemas.qc_review import (
    QcReviewIgnoreOut,
    QcReviewMatchOut,
    QcReviewOut,
    QcReviewWellOut,
)
from app.services import mlwh
from app.services.audit_util import log_action
from app.services.cell_service import run_has_started
from app.services.run_serializer import _use_number
from app.services.settings_service import get_qc_review_lookback_days
from app.timeutil import utcnow

# One row per SMRT-cell well LangQC marked as some kind of failure since :since (by QC sign-off,
# falling back to the well's own end for a verdict with no date), oldest first like the rest of the
# QC worklist. The LIKE is only a cheap
# prefilter; is_facility_failure() decides. Library tubes come through the product-metrics
# bridge, as in the dashboard (one pac_bio_run row per pool member, hence DISTINCT). Grouping by
# the well's primary key is valid under ONLY_FULL_GROUP_BY (every other m.* column depends on it).
# Patterns are bound parameters so no literal % has to survive driver paramstyle escaping.
FLAGGED_WELLS_SQL = text(
    """
    SELECT
        m.pac_bio_run_name                                     AS run_name,
        m.plate_number                                         AS plate_number,
        m.well_label                                           AS well_label,
        m.instrument_name                                      AS instrument_name,
        m.qc_seq_state                                         AS qc_state,
        m.qc_seq_date                                          AS qc_date,
        m.well_start                                           AS well_start,
        m.well_complete                                        AS well_complete,
        m.cell_id                                              AS smrt_cell_id,
        m.cell_lot_number                                      AS cell_lot,
        m.cell_use_count                                       AS cell_use_count,
        m.is_cell_multi_use                                    AS is_multi_use,
        m.sequencing_kit                                       AS sequencing_kit,
        m.movie_name                                           AS movie_name,
        m.movie_minutes                                        AS movie_minutes,
        m.loading_conc                                         AS loading_conc,
        m.hifi_read_bases                                      AS hifi_read_bases,
        m.sl_hostname                                          AS sl_hostname,
        m.sl_run_uuid                                          AS sl_run_uuid,
        GROUP_CONCAT(DISTINCT r.pac_bio_library_tube_barcode)  AS library_barcodes,
        COUNT(DISTINCT r.id_sample_tmp)                        AS sample_count
    FROM pac_bio_run_well_metrics m
    LEFT JOIN pac_bio_product_metrics p ON p.id_pac_bio_rw_metrics_tmp = m.id_pac_bio_rw_metrics_tmp
    LEFT JOIN pac_bio_run r ON r.id_pac_bio_tmp = p.id_pac_bio_tmp
    WHERE m.qc_seq_state LIKE :fail_pattern
      AND COALESCE(m.qc_seq_date, m.well_complete, m.run_complete) >= :since
      AND COALESCE(m.instrument_type, '') NOT LIKE :sequel_pattern
    GROUP BY m.id_pac_bio_rw_metrics_tmp
    ORDER BY COALESCE(m.qc_seq_date, m.well_complete, m.run_complete)
    """
)

# How far before the earliest flagged well's start a RunNx run is still looked at: a run is loaded
# before its wells start (cell prep alone can take over a day), and a reuse Plate 2 later still.
_RUN_LOAD_SLACK = timedelta(days=7)
# Matching an unnamed RunNx run by instrument: its load day may be up to this many days before
# the well started (cells prep for up to ~38 h after loading; a reuse Plate 2 waits for Plate 1).
_UNNAMED_RUN_MAX_LEAD_DAYS = 3


def is_facility_failure(qc_state: str | None) -> bool:
    """A LangQC state that means the SMRT cell or the instrument failed. Matched by shape, as the
    pacbio-dashboard does, so a new cell/instrument failure state is never missed. A plain
    "Failed" (the sample missed its metrics) and an aborted run are not counted."""
    s = (qc_state or "").strip().lower()
    return "fail" in s and any(word in s for word in ("instrument", "smrt", "cell"))


def run_key(name: str | None) -> str | None:
    """A Traction run name, normalised so the name the lab typed into RunNx matches MLWH's:
    case and spacing are ignored, and "TRACTION-RUN-1234", "traction run 1234" and a bare "1234"
    are all the same run."""
    s = " ".join((name or "").split()).upper()
    if not s:
        return None
    m = re.fullmatch(r"(?:TRACTION[-_ ]?RUN[-_ ]?)?0*(\d+)", s)
    return f"TRACTION-RUN-{m.group(1)}" if m else s


def well_key(run_name: str, plate_number: int, well_label: str) -> str:
    """A well's identity across RunNx and MLWH: "<Traction run name>|<plate>|<well>". Not MLWH's
    row id, which the warehouse documents as liable to change."""
    return f"{run_name.strip()}|{plate_number}|{well_label.strip().upper()}"


@dataclass
class MlwhWell:
    run_name: str
    plate_number: int
    well_label: str
    instrument_name: str | None
    qc_state: str
    qc_date: datetime | None
    well_start: datetime | None
    well_complete: datetime | None
    smrt_cell_id: str | None
    cell_lot: str | None
    cell_use_count: int | None
    is_multi_use: bool | None
    sequencing_kit: str | None
    movie_name: str | None
    movie_minutes: float | None
    loading_conc: float | None
    hifi_read_bases: float | None
    sl_hostname: str | None
    sl_run_uuid: str | None
    library_barcodes: list[str]
    sample_count: int

    @property
    def key(self) -> str:
        return well_key(self.run_name, self.plate_number, self.well_label)

    @property
    def start_day(self) -> date | None:
        moment = self.well_start or self.well_complete
        return moment.date() if moment else None


def _dt(value) -> datetime | None:
    """MySQL hands back datetimes; the SQLite stand-in the tests use hands back strings."""
    if value is None or isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def _num(value) -> float | None:
    """MySQL hands DECIMAL columns back as Decimal; the API wants plain numbers."""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _str(value) -> str | None:
    s = str(value).strip() if value is not None else ""
    return s or None


def _well_from_row(row) -> MlwhWell:
    barcodes = sorted({b.strip() for b in (row["library_barcodes"] or "").split(",") if b.strip()})
    multi = row["is_multi_use"]
    use_count = row["cell_use_count"]
    return MlwhWell(
        run_name=_str(row["run_name"]) or "",
        plate_number=int(row["plate_number"] or 1),
        well_label=(_str(row["well_label"]) or "").upper(),
        instrument_name=_str(row["instrument_name"]),
        qc_state=_str(row["qc_state"]) or "",
        qc_date=_dt(row["qc_date"]),
        well_start=_dt(row["well_start"]),
        well_complete=_dt(row["well_complete"]),
        smrt_cell_id=_str(row["smrt_cell_id"]),
        cell_lot=_str(row["cell_lot"]),
        cell_use_count=int(use_count) if use_count is not None else None,
        is_multi_use=bool(multi) if multi is not None else None,
        sequencing_kit=_str(row["sequencing_kit"]),
        movie_name=_str(row["movie_name"]),
        movie_minutes=_num(row["movie_minutes"]),
        loading_conc=_num(row["loading_conc"]),
        hifi_read_bases=_num(row["hifi_read_bases"]),
        sl_hostname=_str(row["sl_hostname"]),
        sl_run_uuid=_str(row["sl_run_uuid"]),
        library_barcodes=barcodes,
        sample_count=int(row["sample_count"] or 0),
    )


def fetch_flagged_wells(engine: Engine, since: datetime) -> list[MlwhWell]:
    """Every Revio well LangQC failed for a SMRT-cell or instrument reason since `since` (naive,
    like MLWH's own timestamps), oldest first. Raises on any MLWH failure."""
    params = {
        "fail_pattern": "%fail%",
        "sequel_pattern": "Sequel%",
        "since": since.strftime("%Y-%m-%d %H:%M:%S"),
    }
    with engine.connect() as conn:
        rows = conn.execute(FLAGGED_WELLS_SQL, params).mappings().all()
    wells = [_well_from_row(r) for r in rows]
    return [w for w in wells if w.run_name and w.well_label and is_facility_failure(w.qc_state)]


def _mlwh_engine() -> Engine:
    """Seam for the tests, which stand an SQLite copy of the MLWH tables in for the warehouse."""
    return mlwh.get_engine()


# --- Matching MLWH wells to RunNx ---------------------------------------------------------


def _load_runs(db: Session, wells: list[MlwhWell], fallback_from: date) -> list[RunBatch]:
    """The RunNx runs any of `wells` could have been loaded as - every run loaded from a week
    before the earliest well started - with everything matching and use numbering reads."""
    days = [w.start_day for w in wells if w.start_day]
    earliest = (min(days) if days else fallback_from) - _RUN_LOAD_SLACK
    stmt = (
        select(RunBatch)
        .where(RunBatch.load_date >= earliest)
        .options(
            selectinload(RunBatch.instrument),
            selectinload(RunBatch.cycles).selectinload(Cycle.cell_uses).selectinload(CellUse.sample),
            selectinload(RunBatch.cycles)
            .selectinload(Cycle.cell_uses)
            .selectinload(CellUse.cell)
            .selectinload(Cell.cell_uses)
            .selectinload(CellUse.cycle),
        )
    )
    return list(db.scalars(stmt))


def _use_at(run: RunBatch, plate_number: int, well_label: str) -> CellUse | None:
    """The use in this plate/well of a RunNx run. Traction's well is the RunNx well's row letter
    on that plate (both a fresh A02 and a reuse A01 on Plate 2 are Traction's Plate 2 A1)."""
    letter = well_label[:1].upper()
    plate = next((c for c in run.cycles if c.plate_index == plate_number), None)
    if plate is None or not letter:
        return None
    uses = [cu for cu in plate.cell_uses if cu.well[:1].upper() == letter]
    # A cancelled use is a Stop-cell "Blocked" marker, not something that loaded.
    return next((cu for cu in uses if cu.status != "cancelled"), None)


class _RunIndex:
    def __init__(self, runs: list[RunBatch]) -> None:
        self.by_name: dict[str, list[RunBatch]] = defaultdict(list)
        self.unnamed_by_instrument: dict[str, list[RunBatch]] = defaultdict(list)
        for run in runs:
            key = run_key(run.run_name)
            if key:
                self.by_name[key].append(run)
            elif run.instrument is not None:
                self.unnamed_by_instrument[run.instrument.serial_number.strip().upper()].append(run)

    def match(self, well: MlwhWell) -> tuple[RunBatch, CellUse | None, str] | None:
        """The RunNx run (and use) for a well: by Traction run name; failing that, a RunNx run
        that has no run name, on the same instrument, loaded up to a few days before the well
        started (the latest such run - the one on the instrument at the time)."""
        named = self.by_name.get(run_key(well.run_name) or "", [])
        if named:
            for run in named:
                use = _use_at(run, well.plate_number, well.well_label)
                if use is not None:
                    return run, use, "run_name"
            return named[0], None, "run_name"
        if not well.instrument_name or well.start_day is None:
            return None
        lead = timedelta(days=_UNNAMED_RUN_MAX_LEAD_DAYS)
        candidates = [
            run
            for run in self.unnamed_by_instrument.get(well.instrument_name.strip().upper(), [])
            if well.start_day - lead <= run.load_date <= well.start_day
        ]
        if not candidates:
            return None
        run = max(candidates, key=lambda r: r.load_date)
        return run, _use_at(run, well.plate_number, well.well_label), "instrument_date"


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


def _smrt_link_url(well: MlwhWell) -> str | None:
    """SMRT Link's own page for the run: its server (read from MLWH - more than one is in use)
    and its SMRT Link run uuid, which is not Traction's run uuid."""
    if not well.sl_hostname or not well.sl_run_uuid:
        return None
    return f"https://{well.sl_hostname}:8243/sl/runs/{well.sl_run_uuid}"


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
        hifi_yield_gb=round(well.hifi_read_bases / 1e9, 2) if well.hifi_read_bases is not None else None,
        library_barcodes=well.library_barcodes,
        sample_count=well.sample_count,
        smrt_link_url=_smrt_link_url(well),
        match=match,
        ignored=QcReviewIgnoreOut(reason=ignore.reason, ignored_by=ignore.ignored_by, ignored_at=ignore.ignored_at)
        if ignore
        else None,
    )


def build_review(db: Session, *, now: datetime | None = None) -> QcReviewOut:
    """The QC Review queue as of `now`. Never raises for MLWH trouble: unset or unreachable comes
    back as configured=False / error, so the rest of the QC page is unaffected."""
    lookback = get_qc_review_lookback_days(db)
    since = (now or utcnow()) - timedelta(days=lookback)
    out = QcReviewOut(configured=mlwh.is_configured(), ok=False, lookback_days=lookback, since=since.date())
    if not out.configured:
        return out
    try:
        wells = fetch_flagged_wells(_mlwh_engine(), since.replace(tzinfo=None))
    except Exception as exc:  # noqa: BLE001 - a bad URL, DNS, TLS, auth or SQL error is a state to show
        out.error = mlwh.error_message(exc)
        return out
    out.ok = True
    if not wells:
        return out

    keys = [w.key for w in wells]
    logged = set(db.scalars(select(PacbioCase.mlwh_well_key).where(PacbioCase.mlwh_well_key.in_(keys))))
    ignores = {i.mlwh_well_key: i for i in db.scalars(select(QcReviewIgnore).where(QcReviewIgnore.mlwh_well_key.in_(keys)))}
    index = _RunIndex(_load_runs(db, wells, since.date()))

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
