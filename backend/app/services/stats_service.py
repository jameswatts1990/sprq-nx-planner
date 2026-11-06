"""Aggregation behind GET /api/stats. There is no other aggregation layer in this app -
every other endpoint returns raw/per-entity rows - so this is the single place lab-wide
figures are rolled up.

Deliberately aggregates in Python, not SQL date functions: this project runs SQLite in
dev and Postgres in prod, and week-bucketing SQL (date_trunc etc.) isn't portable between
them. The dataset is lab-sized (hundreds of runs/cells, not millions), so loading the
rows and rolling them up in memory is simpler and safe. Domain truth is reused from
cell_service (derive_cell_state / current_location / the QC-credit predicates) rather
than re-derived here.

Scoping rules (mirrored in the Help copy):
- Throughput, plate fill, failures and the movie mix count *runs* (RunBatch) by their load date
  within date_from/date_to and instrument_serial, using the derived run status
  (run_serializer.run_status): nothing in the lab workflow marks a run completed, so a running run
  whose last cell is through analysis reads completed. Planned runs are only counted (planned_runs);
  every other figure is over runs that were loaded. A two-plate run is one run; a reuse Plate 2
  acquiring days later stays in its run's load period.
- Reuse depth / window waste count cells that *finished* (terminal, won't gain more uses)
  with their last use inside the range - "of the cells we got through this period, how
  deep did reuse go".
- Cell status, sample funnel and the credit funnel are current "now" snapshots (not date
  filtered): they describe outstanding state, which doesn't stop mattering just because it
  predates the window.
- The credit funnel counts every PacBio credit case: cells' own cases plus cases logged
  without a cell (PacbioCase), the latter scoped to an instrument by the one entered on it.
- Every series is bucketed by week (Monday), month or quarter (first day) - see _bucket.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.engine.constants import CELLS_PER_TRAY
from app.models.cell import Cell
from app.models.importing import ImportBatch
from app.models.instrument import Instrument
from app.models.pacbio_case import PacbioCase
from app.models.sample import SAMPLE_STATUSES, Sample
from app.models.schedule import CellUse, Cycle, RunBatch
from app.schemas.stats import (
    AvgUsesPoint,
    CreditFunnel,
    DepthSlice,
    FailureRatePoint,
    FailureStats,
    GroupBy,
    HeadlineStats,
    ImportVolumePoint,
    InstrumentThroughput,
    InventoryStats,
    MovieHoursSlice,
    OutcomeSlice,
    PeriodPoint,
    PlateFillPoint,
    ReuseStats,
    StatsResponse,
    StatusSlice,
    ThroughputStats,
    WindowWaste,
)
from app.services.cell_service import (
    awaiting_credit,
    current_location,
    derive_cell_state,
    is_single_use,
    last_use_run_date,
    needs_qc_report,
)
from app.services import credit_service
from app.services.run_history_rows import STATUS_OPTIONS, live_plates
from app.services.run_serializer import run_status
from app.timeutil import ensure_aware, utcnow

WELLS_PER_PLATE = CELLS_PER_TRAY  # a plate (Cycle) is one tray: 4 wells
WELL_OUTCOMES = ("completed", "failed", "aborted")
TERMINAL_CELL_STATUSES = ("exhausted", "window_expired", "retired", "stopped")


def _bucket(d: date, group_by: GroupBy) -> date:
    """The first day of d's week (Monday), month or quarter - the key every series groups by."""
    if group_by == "month":
        return d.replace(day=1)
    if group_by == "quarter":
        return date(d.year, 3 * ((d.month - 1) // 3) + 1, 1)
    return d - timedelta(days=d.weekday())


def _in_range(d: date | None, date_from: date | None, date_to: date | None) -> bool:
    if d is None:
        return False
    if date_from and d < date_from:
        return False
    if date_to and d > date_to:
        return False
    return True


def _pct(part: int, whole: int) -> float:
    return round(100 * part / whole, 1) if whole else 0.0


def _well_outcome(cell_use: CellUse, status: str) -> str | None:
    """A loaded well's outcome: its own failed / aborted verdict, else completed once its run reads
    completed (wells are never marked completed in the lab workflow either), else none yet."""
    if cell_use.status in ("failed", "aborted"):
        return cell_use.status
    return "completed" if status == "completed" else None


def compute_stats(
    db: Session,
    date_from: date | None = None,
    date_to: date | None = None,
    instrument_serial: str | None = None,
    group_by: GroupBy = "week",
) -> StatsResponse:
    instruments = list(db.scalars(select(Instrument).order_by(Instrument.serial_number)).all())

    throughput, failures, run_headline, plate_fill = _run_figures(
        db, date_from, date_to, instrument_serial, instruments, group_by
    )
    reuse, reuse_headline = _reuse_and_inventory_cells(db, date_from, date_to, instrument_serial, group_by)
    reuse.plate_fill = plate_fill
    inventory = _inventory(db, reuse_headline["cell_status"], group_by)
    credit = _credit_funnel(db, instrument_serial)
    failures.credit_funnel = credit

    headline = HeadlineStats(
        **run_headline,
        avg_uses_per_cell=reuse_headline["avg_uses"],
        pct_reaching_use3=reuse_headline["pct_use3"],
        cells_awaiting_credit=credit.awaiting,
        credits_received=credit.received,
    )

    return StatsResponse(
        group_by=group_by,
        headline=headline,
        throughput=throughput,
        reuse=reuse,
        failures=failures,
        inventory=inventory,
    )


def _run_figures(db, date_from, date_to, instrument_serial, instruments, group_by):
    """Throughput, plate fill, failures and the movie mix, from the runs loading in range."""
    stmt = select(RunBatch).options(*STATUS_OPTIONS, selectinload(RunBatch.instrument))
    if date_from:
        stmt = stmt.where(RunBatch.load_date >= date_from)
    if date_to:
        stmt = stmt.where(RunBatch.load_date <= date_to)
    if instrument_serial:
        stmt = stmt.join(RunBatch.instrument).where(Instrument.serial_number == instrument_serial)
    runs = list(db.scalars(stmt).unique().all())

    completed: dict[date, int] = defaultdict(int)
    planned: dict[date, int] = defaultdict(int)
    sequenced: dict[date, int] = defaultdict(int)
    fill: dict[date, list[int]] = defaultdict(lambda: [0, 0])  # [wells used, 4 x plates loaded]
    failed: dict[date, int] = defaultdict(int)
    loaded_wells: dict[date, int] = defaultdict(int)
    movie_mix: dict[int, int] = defaultdict(int)
    per_instr: dict[str, list[int]] = defaultdict(lambda: [0, 0])  # serial -> [runs completed, samples sequenced]
    outcomes: dict[str, int] = defaultdict(int)

    now = utcnow()
    for rb in runs:
        plates = live_plates(rb)
        if not plates:
            continue
        status = run_status(rb, plates, now)
        period = _bucket(rb.load_date, group_by)
        if status == "planned":
            planned[period] += 1
            continue

        serial = rb.instrument.serial_number if rb.instrument else "?"
        run_sequenced = 0
        for plate in plates:
            wells = [cu for cu in plate.cell_uses if cu.status != "cancelled"]
            if not wells:
                continue  # a plate holding only a stopped cell's Blocked marker loaded nothing
            fill[period][0] += len(wells)
            fill[period][1] += WELLS_PER_PLATE
            for cu in wells:
                loaded_wells[period] += 1
                movie_mix[cu.run_time_hours or plate.movie_hours] += 1
                if cu.status == "failed":
                    failed[period] += 1
                outcome = _well_outcome(cu, status)
                if outcome:
                    outcomes[outcome] += 1
                if outcome == "completed":
                    run_sequenced += 1
        if status == "completed":
            completed[period] += 1
            sequenced[period] += run_sequenced
            per_instr[serial][0] += 1
            per_instr[serial][1] += run_sequenced

    throughput = ThroughputStats(
        series=[
            PeriodPoint(
                period=p,
                runs_completed=completed[p],
                samples_sequenced=sequenced[p],
                planned_runs=planned[p],
            )
            for p in sorted(set(completed) | set(planned) | set(loaded_wells))
        ],
        per_instrument=[
            InstrumentThroughput(
                serial=ins.serial_number,
                name=ins.name,
                runs_completed=per_instr[ins.serial_number][0],
                samples_sequenced=per_instr[ins.serial_number][1],
            )
            for ins in instruments
            if not instrument_serial or ins.serial_number == instrument_serial
        ],
        movie_hours_mix=[MovieHoursSlice(movie_hours=h, count=movie_mix[h]) for h in sorted(movie_mix)],
    )
    failures = FailureStats(
        outcomes=[OutcomeSlice(status=s, count=outcomes.get(s, 0)) for s in WELL_OUTCOMES],
        failure_rate_trend=[
            FailureRatePoint(period=p, failed=failed[p], total=loaded_wells[p]) for p in sorted(loaded_wells)
        ],
        credit_funnel=CreditFunnel(needs_report=0, reported=0, awaiting=0, received=0),  # filled later
    )
    run_headline = {
        "runs_completed": sum(completed.values()),
        "samples_sequenced": sum(sequenced.values()),
        "planned_runs": sum(planned.values()),
        "failure_rate": _pct(sum(failed.values()), sum(loaded_wells.values())),
        "plate_fill_pct": _pct(sum(v[0] for v in fill.values()), sum(v[1] for v in fill.values())),
    }
    plate_fill = [PlateFillPoint(period=p, filled=fill[p][0], capacity=fill[p][1]) for p in sorted(fill)]
    return throughput, failures, run_headline, plate_fill


def _reuse_and_inventory_cells(db, date_from, date_to, instrument_serial, group_by):
    cells = list(
        db.scalars(
            select(Cell).options(
                selectinload(Cell.cell_uses).selectinload(CellUse.cycle)
                .selectinload(Cycle.run_batch)
                .selectinload(RunBatch.instrument),
                selectinload(Cell.cell_uses).selectinload(CellUse.barcodes),
                selectinload(Cell.tray),
            )
        )
        .unique()
        .all()
    )

    depth: dict[int, int] = defaultdict(int)  # uses (1..3) -> terminal cell count
    period_uses: dict[date, list[int]] = defaultdict(lambda: [0, 0])  # period -> [sum_uses, cell_count]
    full_3 = 0
    expired_early = 0
    terminal_used = 0  # terminal cells in range with >=1 use (denominator for avg / pct)
    uses_sum = 0
    cell_status: dict[str, int] = defaultdict(int)

    for cell in cells:
        serial, _well = current_location(cell)
        if instrument_serial and serial != instrument_serial:
            continue

        cell_status[cell.status] += 1  # snapshot, not date-filtered
        if is_single_use(cell):
            # A single-use SPRQ cell can never be reused - counting it would drag down the
            # reuse-depth / Use-3 / window-waste figures, which measure SPRQ-Nx reuse only.
            continue

        uses_consumed, _remaining, _burned = derive_cell_state(cell)
        is_terminal = cell.status in TERMINAL_CELL_STATUSES or uses_consumed >= cell.max_uses
        last_rd = last_use_run_date(cell)
        if not (is_terminal and uses_consumed >= 1 and _in_range(last_rd, date_from, date_to)):
            continue

        depth[min(3, uses_consumed)] += 1
        period = _bucket(last_rd, group_by)
        period_uses[period][0] += uses_consumed
        period_uses[period][1] += 1
        terminal_used += 1
        uses_sum += uses_consumed
        if uses_consumed >= 3:
            full_3 += 1
        elif cell.window_breached and uses_consumed < cell.max_uses:
            expired_early += 1

    reuse = ReuseStats(
        depth_distribution=[DepthSlice(uses=u, cells=depth.get(u, 0)) for u in (1, 2, 3)],
        avg_uses_trend=[
            AvgUsesPoint(period=p, avg_uses=round(period_uses[p][0] / period_uses[p][1], 2))
            for p in sorted(period_uses)
        ],
        plate_fill=[],  # set from _run_figures in compute_stats
        window_waste=WindowWaste(full_3_uses=full_3, expired_early=expired_early),
    )
    reuse_headline = {
        "avg_uses": round(uses_sum / terminal_used, 2) if terminal_used else 0.0,
        "pct_use3": _pct(full_3, terminal_used),
        "cell_status": [
            StatusSlice(status=s, count=cell_status[s]) for s in sorted(cell_status)
        ],
    }
    return reuse, reuse_headline


def _inventory(db, cell_status_slices, group_by):
    sample_rows = dict(db.execute(select(Sample.status, func.count()).group_by(Sample.status)).all())
    # Only the two columns the chart needs - never each batch's whole pasted file (raw_text).
    period_import: dict[date, int] = defaultdict(int)
    for created_at, imported_count in db.execute(select(ImportBatch.created_at, ImportBatch.imported_count)):
        if created_at is None:
            continue
        period_import[_bucket(ensure_aware(created_at).date(), group_by)] += imported_count or 0

    return InventoryStats(
        cell_status=cell_status_slices,
        sample_funnel=[
            StatusSlice(status=s, count=sample_rows.get(s, 0)) for s in SAMPLE_STATUSES if sample_rows.get(s, 0)
        ],
        import_volume=[ImportVolumePoint(period=p, imported=period_import[p]) for p in sorted(period_import)],
    )


def _credit_funnel(db, instrument_serial) -> CreditFunnel:
    cells = list(
        db.scalars(
            select(Cell).options(
                selectinload(Cell.cell_uses).selectinload(CellUse.cycle)
                .selectinload(Cycle.run_batch)
                .selectinload(RunBatch.instrument),
                selectinload(Cell.tray),
            )
        )
        .unique()
        .all()
    )
    needs = reported = awaiting = received = 0
    for cell in cells:
        if instrument_serial:
            serial, _ = current_location(cell)
            if serial != instrument_serial:
                continue
        if needs_qc_report(cell):
            needs += 1
        if cell.pacbio_reported_at is not None:
            reported += 1
        if awaiting_credit(cell):
            awaiting += 1
        if cell.credit_received_at is not None:
            received += 1
    for case in db.scalars(select(PacbioCase).options(selectinload(PacbioCase.instrument))):
        if instrument_serial and (case.instrument is None or case.instrument.serial_number != instrument_serial):
            continue
        if credit_service.needs_report(case):
            needs += 1
        else:
            reported += 1
        if credit_service.awaiting_credit(case):
            awaiting += 1
        if case.credit_received_at is not None:
            received += 1
    return CreditFunnel(needs_report=needs, reported=reported, awaiting=awaiting, received=received)
