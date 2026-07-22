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
- Time-series + throughput respect date_from/date_to (by run_date) and instrument_serial.
- Reuse depth / window waste count cells that *finished* (terminal, won't gain more uses)
  with their last use inside the range - "of the cells we got through this period, how
  deep did reuse go".
- Cell status, sample funnel and the credit funnel are current "now" snapshots (not date
  filtered): they describe outstanding state, which doesn't stop mattering just because it
  predates the window.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.engine.constants import WELLS
from app.models.cell import Cell
from app.models.importing import ImportBatch
from app.models.instrument import Instrument
from app.models.sample import SAMPLE_STATUSES, Sample
from app.models.schedule import CellUse, Cycle, RunBatch
from app.schemas.stats import (
    AvgUsesPoint,
    CreditFunnel,
    DepthSlice,
    FailureRatePoint,
    FailureStats,
    HeadlineStats,
    ImportVolumePoint,
    InstrumentThroughput,
    InventoryStats,
    MovieHoursSlice,
    OutcomeSlice,
    ReuseStats,
    StatsResponse,
    StatusSlice,
    ThroughputStats,
    WeekPoint,
    WellFillPoint,
    WindowWaste,
)
from app.services.cell_service import (
    awaiting_credit,
    current_location,
    derive_cell_state,
    last_use_run_date,
    needs_qc_report,
)
from app.timeutil import ensure_aware

WELLS_PER_RUN = len(WELLS)  # capacity per (instrument, day) run
# CellUse statuses that represent a run that actually happened and got a verdict.
VERDICT_STATUSES = ("completed", "failed", "aborted")
TERMINAL_CELL_STATUSES = ("exhausted", "window_expired", "retired", "stopped")


def _monday(d: date) -> date:
    """The Monday of d's week - the bucket key for every weekly series."""
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


def compute_stats(
    db: Session,
    date_from: date | None = None,
    date_to: date | None = None,
    instrument_serial: str | None = None,
) -> StatsResponse:
    instruments = list(db.scalars(select(Instrument).order_by(Instrument.serial_number)).all())

    throughput, runs_completed, samples_completed, headline_bits = _throughput_and_failures(
        db, date_from, date_to, instrument_serial, instruments
    )
    failures = headline_bits["failures"]

    reuse, reuse_headline = _reuse_and_inventory_cells(db, date_from, date_to, instrument_serial)
    reuse.well_fill = headline_bits["well_fill"]
    inventory = _inventory(db, reuse_headline["cell_status"])
    credit = _credit_funnel(db, instrument_serial)
    failures.credit_funnel = credit

    headline = HeadlineStats(
        runs_completed=runs_completed,
        samples_completed=samples_completed,
        avg_uses_per_cell=reuse_headline["avg_uses"],
        pct_reaching_use3=reuse_headline["pct_use3"],
        failure_rate=headline_bits["failure_rate"],
        well_fill_pct=headline_bits["well_fill_pct"],
        cells_awaiting_credit=credit.awaiting,
        credits_received=credit.received,
    )

    return StatsResponse(
        headline=headline,
        throughput=throughput,
        reuse=reuse,
        failures=failures,
        inventory=inventory,
    )


def _throughput_and_failures(db, date_from, date_to, instrument_serial, instruments):
    cyc_stmt = (
        select(Cycle)
        .join(Cycle.run_batch)
        .options(
            selectinload(Cycle.run_batch).selectinload(RunBatch.instrument),
            selectinload(Cycle.cell_uses),
        )
    )
    if date_from:
        cyc_stmt = cyc_stmt.where(RunBatch.run_date >= date_from)
    if date_to:
        cyc_stmt = cyc_stmt.where(RunBatch.run_date <= date_to)
    if instrument_serial:
        cyc_stmt = cyc_stmt.join(RunBatch.instrument).where(Instrument.serial_number == instrument_serial)
    cycles = list(db.scalars(cyc_stmt).unique().all())

    weekly_runs: dict[date, int] = defaultdict(int)
    weekly_samples: dict[date, int] = defaultdict(int)
    weekly_fill: dict[date, list[int]] = defaultdict(lambda: [0, 0])  # [filled, capacity]
    weekly_failed: dict[date, int] = defaultdict(int)
    weekly_verdicts: dict[date, int] = defaultdict(int)
    movie_mix: dict[int, int] = defaultdict(int)
    per_instr: dict[str, list[int]] = defaultdict(lambda: [0, 0])  # serial -> [runs, cell_uses]
    outcomes: dict[str, int] = defaultdict(int)
    runs_completed = 0
    samples_completed = 0

    for cyc in cycles:
        week = _monday(cyc.run_batch.run_date)
        serial = cyc.run_batch.instrument.serial_number if cyc.run_batch.instrument else "?"
        active = [cu for cu in cyc.cell_uses if cu.status != "cancelled"]

        weekly_runs[week] += 1
        weekly_samples[week] += len(active)
        weekly_fill[week][0] += len(active)
        weekly_fill[week][1] += WELLS_PER_RUN
        movie_mix[cyc.movie_hours] += 1
        per_instr[serial][0] += 1
        per_instr[serial][1] += len(active)
        if cyc.status == "completed":
            runs_completed += 1

        for cu in cyc.cell_uses:
            if cu.status in VERDICT_STATUSES:
                outcomes[cu.status] += 1
                weekly_verdicts[week] += 1
                if cu.status == "completed":
                    samples_completed += 1
                if cu.status == "failed":
                    weekly_failed[week] += 1

    total_verdicts = sum(outcomes.values())
    total_filled = sum(v[0] for v in weekly_fill.values())
    total_capacity = sum(v[1] for v in weekly_fill.values())

    throughput = ThroughputStats(
        series=[
            WeekPoint(week=w, runs=weekly_runs[w], samples=weekly_samples[w])
            for w in sorted(set(weekly_runs) | set(weekly_samples))
        ],
        per_instrument=[
            InstrumentThroughput(
                serial=ins.serial_number,
                name=ins.name,
                runs=per_instr[ins.serial_number][0],
                cell_uses=per_instr[ins.serial_number][1],
            )
            for ins in instruments
            if not instrument_serial or ins.serial_number == instrument_serial
        ],
        movie_hours_mix=[MovieHoursSlice(movie_hours=h, count=movie_mix[h]) for h in sorted(movie_mix)],
    )

    failures = FailureStats(
        outcomes=[OutcomeSlice(status=s, count=outcomes.get(s, 0)) for s in VERDICT_STATUSES],
        failure_rate_trend=[
            FailureRatePoint(week=w, failed=weekly_failed[w], total=weekly_verdicts[w])
            for w in sorted(weekly_verdicts)
        ],
        credit_funnel=CreditFunnel(needs_report=0, reported=0, awaiting=0, received=0),  # filled later
    )

    headline_bits = {
        "failures": failures,
        "failure_rate": _pct(outcomes.get("failed", 0), total_verdicts),
        "well_fill_pct": _pct(total_filled, total_capacity),
        "well_fill": [
            WellFillPoint(week=w, filled=weekly_fill[w][0], capacity=weekly_fill[w][1])
            for w in sorted(weekly_fill)
        ],
    }
    return throughput, runs_completed, samples_completed, headline_bits


def _reuse_and_inventory_cells(db, date_from, date_to, instrument_serial):
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
    weekly_uses: dict[date, list[int]] = defaultdict(lambda: [0, 0])  # week -> [sum_uses, cell_count]
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

        uses_consumed, _remaining, _burned = derive_cell_state(cell)
        is_terminal = cell.status in TERMINAL_CELL_STATUSES or uses_consumed >= cell.max_uses
        last_rd = last_use_run_date(cell)
        if not (is_terminal and uses_consumed >= 1 and _in_range(last_rd, date_from, date_to)):
            continue

        depth[min(3, uses_consumed)] += 1
        week = _monday(last_rd)
        weekly_uses[week][0] += uses_consumed
        weekly_uses[week][1] += 1
        terminal_used += 1
        uses_sum += uses_consumed
        if uses_consumed >= 3:
            full_3 += 1
        elif cell.window_breached and uses_consumed < cell.max_uses:
            expired_early += 1

    reuse = ReuseStats(
        depth_distribution=[DepthSlice(uses=u, cells=depth.get(u, 0)) for u in (1, 2, 3)],
        avg_uses_trend=[
            AvgUsesPoint(week=w, avg_uses=round(weekly_uses[w][0] / weekly_uses[w][1], 2))
            for w in sorted(weekly_uses)
        ],
        well_fill=[],  # set from the throughput pass's weekly_fill in compute_stats
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


def _inventory(db, cell_status_slices):
    sample_rows = dict(db.execute(select(Sample.status, func.count()).group_by(Sample.status)).all())
    imports = list(db.scalars(select(ImportBatch)).all())
    weekly_import: dict[date, int] = defaultdict(int)
    for imp in imports:
        if imp.created_at is None:
            continue
        weekly_import[_monday(ensure_aware(imp.created_at).date())] += imp.imported_count or 0

    return InventoryStats(
        cell_status=cell_status_slices,
        sample_funnel=[
            StatusSlice(status=s, count=sample_rows.get(s, 0)) for s in SAMPLE_STATUSES if sample_rows.get(s, 0)
        ],
        import_volume=[ImportVolumePoint(week=w, imported=weekly_import[w]) for w in sorted(weekly_import)],
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
    return CreditFunnel(needs_report=needs, reported=reported, awaiting=awaiting, received=received)
