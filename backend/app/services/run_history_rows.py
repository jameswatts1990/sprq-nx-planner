"""The Run history page's rows: each run (RunBatch) as a summary plus a compact record of every
loaded well. Searched, filtered, sorted and paged in SQL, so a page costs the same however long
the history grows - only a running/completed status filter needs every candidate's status first.
Lighter than run_serializer.run_out: none of the grid feed's lock, clash, duplicate or
reuse-timing work."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import String, and_, cast, func, or_, select
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.sql import ColumnElement

from app.models.cell import Cell
from app.models.instrument import Instrument
from app.models.sample import Sample, sample_id_matches
from app.models.schedule import CYCLE_STATUSES, CellUse, CellUseBarcode, Cycle, RunBatch
from app.schemas.run import RunHistoryRowOut, RunHistoryWellOut, ScheduleSearchHitOut
from app.services.cell_service import run_cell_type
from app.services.run_serializer import _slot_index, _use_number, run_status
from app.timeutil import ensure_aware, utcnow

HISTORY_SORTS = ("load_date", "run", "instrument")
SORT_DIRS = ("asc", "desc")

# run_status reads each plate's wells' cells and those cells' whole use lists with their plates -
# the timing model behind a running run reading completed once its last cell is through PPA.
# _use_number walks the same lists. Shared with stats_service, which counts runs by this status.
STATUS_OPTIONS = [
    selectinload(RunBatch.cycles)
    .selectinload(Cycle.cell_uses)
    .selectinload(CellUse.cell)
    .selectinload(Cell.cell_uses)
    .selectinload(CellUse.cycle),
]
_ROW_OPTIONS = [
    *STATUS_OPTIONS,
    selectinload(RunBatch.instrument),
    selectinload(RunBatch.cycles).selectinload(Cycle.cell_uses).selectinload(CellUse.sample),
    selectinload(RunBatch.cycles).selectinload(Cycle.cell_uses).selectinload(CellUse.barcodes),
]


def _has_plate(*conditions: ColumnElement[bool]) -> ColumnElement[bool]:
    """The run has a plate with at least one well (of any status) meeting `conditions`. Empty
    plates are ignored, as run_serializer.run_out drops them."""
    return RunBatch.cycles.any(and_(Cycle.cell_uses.any(), *conditions))


def status_clause(status: str) -> ColumnElement[bool]:
    """SQL for run_serializer.run_status. Exact for planned and aborted; for running and
    completed a sound superset (every run with a running plate), since a running run whose last
    cell is through PPA reads completed - that split is settled per run in Python."""
    running = _has_plate(Cycle.status == "running")
    all_done = and_(_has_plate(), ~_has_plate(Cycle.status.notin_(("completed", "aborted"))))
    any_completed = _has_plate(Cycle.status == "completed")
    if status == "planned":
        return and_(~running, ~all_done)
    if status == "aborted":
        return and_(all_done, ~any_completed)
    if status == "running":
        return running
    return or_(running, and_(all_done, any_completed))


def _well_matches(term: str) -> ColumnElement[bool]:
    """A well matching the search: its sample's Pool / Plate / Sanger IDs, a burned barcode, its
    cell's code, or - "T12" - its cell's tray."""
    like = f"%{term}%"
    conditions = [
        CellUse.sample.has(sample_id_matches(like)),
        CellUse.barcodes.any(CellUseBarcode.barcode.ilike(like)),
        CellUse.cell.has(Cell.code.ilike(like)),
    ]
    if term[:1] in ("t", "T") and term[1:].isdigit():
        conditions.append(CellUse.cell.has(Cell.tray_id == int(term[1:])))
    return or_(*conditions)


def run_identity_clause(term: str) -> ColumnElement[bool]:
    """A run matching on its own name or its "#45" / "45" id."""
    conditions = [RunBatch.run_name.ilike(f"%{term}%")]
    run_token = term[1:] if term[:1] == "#" else term
    if run_token.isdigit():
        conditions.append(RunBatch.id == int(run_token))
    return or_(*conditions)


def search_clause(term: str) -> ColumnElement[bool]:
    """A run matching the search on its own name, "#45" id, instrument or load date, or on any
    of its wells (_well_matches)."""
    like = f"%{term}%"
    return or_(
        run_identity_clause(term),
        cast(RunBatch.load_date, String).ilike(like),
        RunBatch.instrument.has(or_(Instrument.serial_number.ilike(like), Instrument.name.ilike(like))),
        RunBatch.cycles.any(Cycle.cell_uses.any(_well_matches(term))),
    )


def schedule_search(db: Session, term: str, limit: int) -> list[ScheduleSearchHitOut]:
    """The Schedule header search: every grid slot, across the whole timeline, whose well matches
    (_well_matches) or whose run matches by name / id (run_identity_clause - the whole run's
    slots). Unlike search_clause it skips load date and instrument, which would light up every
    slot of a week or a machine. Keeps the `limit` latest-loading hits, returned in grid reading
    order: date, instrument, slot."""
    rows = db.execute(
        select(
            RunBatch.id,
            RunBatch.run_name,
            RunBatch.load_date,
            Instrument.serial_number,
            Cycle.plate_index,
            CellUse.well,
            Sample.pool_id,
        )
        .select_from(CellUse)
        .join(Cycle, CellUse.cycle_id == Cycle.id)
        .join(RunBatch, Cycle.run_batch_id == RunBatch.id)
        .join(Instrument, RunBatch.instrument_id == Instrument.id)
        .outerjoin(Sample, CellUse.sample_id == Sample.id)
        .where(or_(run_identity_clause(term), _well_matches(term)))
        .order_by(RunBatch.load_date.desc(), Instrument.serial_number, Cycle.plate_index, CellUse.well, CellUse.id)
        .limit(limit)
    )
    hits: dict[tuple[str, date, int], ScheduleSearchHitOut] = {}
    for run_id, run_name, load_date, serial, plate_index, well, pool_id in rows:
        slot = _slot_index(plate_index, well)
        # A cancelled "Blocked" marker can share a slot with a live use; the grid shows one card.
        hits.setdefault(
            (serial, load_date, slot),
            ScheduleSearchHitOut(
                run_id=run_id,
                run_name=run_name,
                load_date=load_date,
                instrument_serial=serial,
                slot_index=slot,
                sample_pool_id=pool_id,
            ),
        )
    return sorted(hits.values(), key=lambda h: (h.load_date, h.instrument_serial, h.slot_index))


def _order_by(sort_by: str, sort_dir: str) -> list:
    """The sort column, then newest-first tie-breaks so equal values keep a stable order."""
    columns = {"load_date": RunBatch.load_date, "run": RunBatch.id, "instrument": Instrument.serial_number}
    primary = columns[sort_by]
    order = [primary.asc() if sort_dir == "asc" else primary.desc()]
    if sort_by != "load_date":
        order.append(RunBatch.load_date.desc())
    if sort_by != "instrument":
        order.append(Instrument.serial_number.asc())
    if sort_by != "run":
        order.append(RunBatch.id.desc())
    return order


def live_plates(run_batch: RunBatch) -> list[Cycle]:
    """The run's plates holding any well, in plate order - what run_status and run_out read (an
    orphaned empty plate is ignored)."""
    return sorted((c for c in run_batch.cycles if c.cell_uses), key=lambda c: c.plate_index)


def _load(db: Session, ids: list[int], options: list) -> dict[int, RunBatch]:
    if not ids:
        return {}
    return {rb.id: rb for rb in db.scalars(select(RunBatch).where(RunBatch.id.in_(ids)).options(*options)).unique()}


def _well(cell_use: CellUse, plate_index: int) -> RunHistoryWellOut:
    cell = cell_use.cell
    sample = cell_use.sample
    return RunHistoryWellOut(
        cell_use_id=cell_use.id,
        plate_index=plate_index,
        well=cell_use.well,
        status=cell_use.status,
        use_number=_use_number(cell_use),
        cell_id=cell_use.cell_id,
        cell_code=cell.code if cell else "?",
        cell_max_uses=cell.max_uses if cell else 3,
        tray_id=cell.tray_id if cell else None,
        sample_id=cell_use.sample_id,
        sample_pool_id=sample.pool_id if sample else None,
        barcodes=cell_use.barcode_list,
        # UTC-aware so they serialize with a "Z" on SQLite too (see run_serializer._plate_out).
        started_at=ensure_aware(cell_use.started_at) if cell_use.started_at else None,
        completed_at=ensure_aware(cell_use.completed_at) if cell_use.completed_at else None,
    )


def run_history_row(run_batch: RunBatch, matched_use_ids: set[int], now: datetime) -> RunHistoryRowOut:
    plates = live_plates(run_batch)
    plate1 = plates[0] if plates else None
    wells = [_well(cu, p.plate_index) for p in plates for cu in sorted(p.cell_uses, key=lambda u: (u.well, u.id))]
    return RunHistoryRowOut(
        run_id=run_batch.id,
        run_name=run_batch.run_name,
        load_date=run_batch.load_date,
        instrument_serial=run_batch.instrument.serial_number if run_batch.instrument else "?",
        status=run_status(run_batch, plates, now),
        cell_type=run_cell_type(plates),
        plate_count=len(plates),
        movie_hours=max((p.movie_hours for p in plates), default=None),
        loaded_at=ensure_aware(plate1.actual_start_at or plate1.planned_start_at) if plate1 else None,
        loaded=plate1 is not None and plate1.actual_start_at is not None,
        wells=wells,
        matched_use_ids=[w.cell_use_id for w in wells if w.cell_use_id in matched_use_ids],
    )


def list_history_rows(
    db: Session,
    *,
    status: str | None,
    instrument_serial: str | None,
    cell_type: str | None,
    date_from: date | None,
    date_to: date | None,
    q: str | None,
    sort_by: str,
    sort_dir: str,
    page: int,
    page_size: int,
) -> tuple[list[RunHistoryRowOut], int]:
    """One page of Run history rows and the total matching. Raises ValueError on an unknown
    status / sort."""
    if status and status not in CYCLE_STATUSES:
        raise ValueError(f"Unknown status '{status}'. Valid: {', '.join(CYCLE_STATUSES)}")
    if sort_by not in HISTORY_SORTS:
        raise ValueError(f"Unknown sort_by '{sort_by}'. Valid: {', '.join(HISTORY_SORTS)}")
    if sort_dir not in SORT_DIRS:
        raise ValueError(f"Unknown sort_dir '{sort_dir}'. Valid: {', '.join(SORT_DIRS)}")

    stmt = select(RunBatch.id).join(RunBatch.instrument)
    if instrument_serial:
        stmt = stmt.where(Instrument.serial_number == instrument_serial)
    if date_from:
        stmt = stmt.where(RunBatch.load_date >= date_from)
    if date_to:
        stmt = stmt.where(RunBatch.load_date <= date_to)
    if cell_type:
        # A run is one cell type across both plates (run_cell_type), so a single live SPRQ well
        # marks the whole run SPRQ; a run with none reads SPRQ-Nx.
        sprq = RunBatch.cycles.any(
            Cycle.cell_uses.any(and_(CellUse.status != "cancelled", CellUse.cell.has(Cell.cell_type == "sprq")))
        )
        stmt = stmt.where(sprq if cell_type == "sprq" else ~sprq)
    term = (q or "").strip()
    if term:
        stmt = stmt.where(search_clause(term))
    if status:
        stmt = stmt.where(status_clause(status))
    stmt = stmt.order_by(*_order_by(sort_by, sort_dir))

    now = utcnow()
    start = (page - 1) * page_size
    if status in ("running", "completed"):
        ids = list(db.scalars(stmt))
        runs = _load(db, ids, STATUS_OPTIONS)
        ids = [i for i in ids if run_status(runs[i], live_plates(runs[i]), now) == status]
        total = len(ids)
        page_ids = ids[start : start + page_size]
    else:
        total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
        page_ids = list(db.scalars(stmt.limit(page_size).offset(start)))

    runs = _load(db, page_ids, _ROW_OPTIONS)
    matched: set[int] = set()
    if term and page_ids:
        matched = set(
            db.scalars(
                select(CellUse.id).join(CellUse.cycle).where(Cycle.run_batch_id.in_(page_ids), _well_matches(term))
            )
        )
    return [run_history_row(runs[i], matched, now) for i in page_ids], total
