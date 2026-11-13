"""Aggregation math for stats_service.compute_stats, built directly against ORM rows so
statuses/dates that are awkward to reach through the API (completed cycles, failed uses,
window-breached cells, credit timestamps) can be set precisely."""
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401  register every model on Base.metadata
from app.db import Base
from app.models.cell import Cell
from app.models.importing import ImportBatch
from app.models.instrument import Instrument
from app.models.sample import Sample
from app.models.schedule import CellUse, Cycle, RunBatch
from app.services.stats_service import compute_stats
from app.timeutil import utcnow

DT = datetime(2026, 7, 6, 12, 0, tzinfo=timezone.utc)
WEEK_A = date(2026, 7, 6)  # Monday
WEEK_B = date(2026, 7, 13)  # Monday


@pytest.fixture
def session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    for serial in ["84047", "84098"]:
        s.add(Instrument(serial_number=serial, active=True))
    s.commit()
    try:
        yield s
    finally:
        s.close()
        engine.dispose()


def _instr(session, serial: str) -> int:
    return session.scalar(select(Instrument.id).where(Instrument.serial_number == serial))


def _run(session, instrument_id, run_date, status, movie_hours, uses, *, start=DT, plate2=None):
    """uses: list of (cell, use_status, well). plate2: optional (acquire_date, uses) for a second
    plate in the same run. `start` is the plates' planned (and, once loaded, actual) start."""
    rb = RunBatch(instrument_id=instrument_id, load_date=run_date)
    session.add(rb)
    session.flush()
    plates = [(1, run_date, uses)] + ([(2, plate2[0], plate2[1])] if plate2 else [])
    first = None
    for plate_index, acquire_date, plate_uses in plates:
        cyc = Cycle(
            run_batch_id=rb.id,
            plate_index=plate_index,
            acquire_date=acquire_date,
            movie_hours=movie_hours,
            planned_start_at=start,
            planned_end_at=start,
            actual_start_at=start if status != "planned" else None,
            status=status,
        )
        session.add(cyc)
        session.flush()
        for cell, use_status, well in plate_uses:
            session.add(CellUse(cycle_id=cyc.id, cell_id=cell.id, well=well, status=use_status))
        first = first or cyc
    session.flush()
    return first


@pytest.fixture
def seeded(session):
    i47 = _instr(session, "84047")
    c1 = Cell(code="C1", max_uses=3, status="exhausted")
    c2 = Cell(code="C2", max_uses=3, status="open", pacbio_reported_at=DT)
    c3 = Cell(code="C3", max_uses=3, status="window_expired", window_breached=True, pacbio_reported_at=DT, credit_received_at=DT)
    session.add_all([c1, c2, c3])
    session.flush()

    _run(session, i47, WEEK_A, "completed", 24, [(c1, "completed", "A01"), (c2, "failed", "B01")])
    _run(session, i47, date(2026, 7, 8), "completed", 24, [(c1, "completed", "A01"), (c3, "completed", "B01")])
    _run(session, i47, WEEK_B, "planned", 12, [(c1, "completed", "A01"), (c3, "completed", "B01")])

    session.add_all([Sample(pool_id="S1", status="backlog"), Sample(pool_id="S2", status="backlog"),
                     Sample(pool_id="S3", status="completed")])
    session.add(ImportBatch(raw_text="x", imported_count=5))
    session.commit()
    return session


def test_headline_and_throughput(seeded):
    r = compute_stats(seeded)
    h = r.headline
    assert h.runs_completed == 2  # two completed runs; week B's is still planned
    assert h.planned_runs == 1
    # Wells on completed runs that didn't fail: run 1's C1 (C2 failed) + run 2's C1 and C3. The
    # planned run's wells don't count, whatever their own status.
    assert h.samples_sequenced == 3
    assert h.failure_rate == pytest.approx(25.0)  # 1 failed / 4 wells loaded
    # Plate fill is wells used of 4 per plate loaded: 4 / (2 plates * 4).
    assert h.plate_fill_pct == pytest.approx(50.0)
    assert h.avg_uses_per_cell == pytest.approx(2.5)  # terminal cells C1(3), C3(2)
    assert h.pct_reaching_use3 == pytest.approx(50.0)

    periods = {p.period: (p.runs_completed, p.samples_sequenced, p.planned_runs) for p in r.throughput.series}
    assert periods == {WEEK_A: (2, 3, 0), WEEK_B: (0, 0, 1)}
    assert {m.movie_hours: m.count for m in r.throughput.movie_hours_mix} == {24: 4}  # per loaded well
    per = {p.serial: p for p in r.throughput.per_instrument}
    assert (per["84047"].runs_completed, per["84047"].samples_sequenced) == (2, 3)
    assert per["84098"].runs_completed == 0


def test_reuse_failures_inventory(seeded):
    r = compute_stats(seeded)
    depth = {d.uses: d.cells for d in r.reuse.depth_distribution}
    assert depth == {1: 0, 2: 1, 3: 1}
    assert r.reuse.window_waste.full_3_uses == 1
    assert r.reuse.window_waste.expired_early == 1

    outcomes = {o.status: o.count for o in r.failures.outcomes}
    assert outcomes == {"completed": 3, "failed": 1, "aborted": 0}

    funnel = r.failures.credit_funnel
    assert funnel.reported == 2 and funnel.awaiting == 1 and funnel.received == 1

    cell_status = {c.status: c.count for c in r.inventory.cell_status}
    assert cell_status == {"exhausted": 1, "open": 1, "window_expired": 1}
    sample_funnel = {s.status: s.count for s in r.inventory.sample_funnel}
    assert sample_funnel == {"backlog": 2, "completed": 1}
    assert sum(p.imported for p in r.inventory.import_volume) == 5


def test_failure_rate_counts_in_progress_samples_as_sequenced(session):
    # A run mid-flight (loaded an hour ago): one cell already Mark-Failed, three siblings still
    # "started" (loaded, no verdict yet). Failure rate is over all four loaded wells, not just the
    # 1 verdict.
    i47 = _instr(session, "84047")
    cells = [Cell(code=f"X{n}", max_uses=3, status="open") for n in range(4)]
    session.add_all(cells)
    session.flush()
    _run(session, i47, WEEK_A, "running", 24, [
        (cells[0], "failed", "A01"),
        (cells[1], "started", "B01"),
        (cells[2], "started", "C01"),
        (cells[3], "started", "D01"),
    ], start=utcnow() - timedelta(hours=1))
    session.commit()

    r = compute_stats(session)
    assert r.headline.failure_rate == pytest.approx(25.0)  # 1 failed / 4 sequenced
    trend = {p.period: p for p in r.failures.failure_rate_trend}
    assert trend[WEEK_A].failed == 1 and trend[WEEK_A].total == 4
    # Still sequencing: only the failed well has an outcome, and the run is neither completed nor planned.
    assert {o.status: o.count for o in r.failures.outcomes} == {"completed": 0, "failed": 1, "aborted": 0}
    assert (r.headline.runs_completed, r.headline.planned_runs, r.headline.samples_sequenced) == (0, 0, 0)


def test_date_range_excludes_out_of_window_runs(seeded):
    # Only week B is in range: two of the three runs drop out.
    r = compute_stats(seeded, date_from=WEEK_B, date_to=date(2026, 7, 17))
    assert {p.period for p in r.throughput.series} == {WEEK_B}
    assert r.headline.runs_completed == 0  # week B's only run is "planned"


def test_instrument_filter_scopes_time_series_and_cells(seeded):
    i98 = _instr(seeded, "84098")
    c4 = Cell(code="C4", max_uses=3, status="exhausted")
    seeded.add(c4)
    seeded.flush()
    _run(seeded, i98, WEEK_A, "completed", 30, [(c4, "completed", "A01")])
    seeded.commit()

    r = compute_stats(seeded, instrument_serial="84098")
    assert [p.serial for p in r.throughput.per_instrument] == ["84098"]
    assert r.throughput.per_instrument[0].runs_completed == 1
    # C4 is the only cell on 84098; C1-C3 (pinned to 84047) are excluded from the snapshot
    assert {c.status: c.count for c in r.inventory.cell_status} == {"exhausted": 1}

def test_a_two_plate_run_is_one_run_filling_8_wells_in_its_load_week(session):
    # Loads Friday; its reuse Plate 2 acquires the following Monday - still this run, this week.
    i47 = _instr(session, "84047")
    cells = [Cell(code=f"T{n}", max_uses=3, status="open") for n in range(4)]
    session.add_all(cells)
    session.flush()
    friday = date(2026, 7, 10)
    _run(
        session, i47, friday, "completed", 24,
        [(c, "completed", w) for c, w in zip(cells, ("A01", "B01", "C01", "D01"), strict=True)],
        plate2=(WEEK_B, [(cells[0], "completed", "A01"), (cells[1], "completed", "B01")]),
    )
    session.commit()

    r = compute_stats(session)
    assert r.headline.runs_completed == 1
    assert r.headline.samples_sequenced == 6
    assert [(p.period, p.runs_completed) for p in r.throughput.series] == [(WEEK_A, 1)]
    assert [(p.period, p.filled, p.capacity) for p in r.reuse.plate_fill] == [(WEEK_A, 6, 8)]
    assert r.headline.plate_fill_pct == pytest.approx(75.0)


def test_a_running_run_past_its_acquisition_end_counts_as_completed(session):
    # Nothing in the lab workflow marks a run completed: Confirm loaded leaves it "running" and its
    # wells "started". Once its last cell is through analysis it reads completed.
    i47 = _instr(session, "84047")
    cells = [Cell(code=f"R{n}", max_uses=3, status="open") for n in range(2)]
    session.add_all(cells)
    session.flush()
    _run(session, i47, WEEK_A, "running", 24, [(cells[0], "started", "A01"), (cells[1], "failed", "B01")])
    session.commit()

    r = compute_stats(session)
    assert (r.headline.runs_completed, r.headline.samples_sequenced, r.headline.planned_runs) == (1, 1, 0)
    assert {o.status: o.count for o in r.failures.outcomes} == {"completed": 1, "failed": 1, "aborted": 0}


@pytest.mark.parametrize(
    ("group_by", "expected"),
    [
        ("week", {date(2026, 6, 29): 1, WEEK_A: 1, date(2026, 8, 3): 1, date(2026, 10, 5): 1}),
        ("month", {date(2026, 6, 1): 1, date(2026, 7, 1): 1, date(2026, 8, 1): 1, date(2026, 10, 1): 1}),
        ("quarter", {date(2026, 4, 1): 1, date(2026, 7, 1): 2, date(2026, 10, 1): 1}),
    ],
)
def test_series_bucket_by_week_month_or_quarter(session, group_by, expected):
    i47 = _instr(session, "84047")
    for n, day in enumerate((date(2026, 6, 30), WEEK_A, date(2026, 8, 5), date(2026, 10, 9))):
        cell = Cell(code=f"B{n}", max_uses=3, status="open")
        session.add(cell)
        session.flush()
        _run(session, i47, day, "completed", 24, [(cell, "completed", "A01")])
    session.commit()

    r = compute_stats(session, group_by=group_by)
    assert r.group_by == group_by
    assert {p.period: p.runs_completed for p in r.throughput.series} == expected
    assert {p.period for p in r.failures.failure_rate_trend} == set(expected)


def test_availability_counts_down_weekdays_by_kind_up_to_today(session):
    from app.models.instrument_downtime import InstrumentDowntime

    i47 = _instr(session, "84047")
    session.add_all(
        [
            # Tue-Wed of WEEK_A planned; Fri of WEEK_A through Mon of WEEK_B unplanned (weekend free).
            InstrumentDowntime(instrument_id=i47, start_date=WEEK_A + timedelta(days=1), end_date=WEEK_A + timedelta(days=2), kind="planned"),
            InstrumentDowntime(instrument_id=i47, start_date=WEEK_A + timedelta(days=4), end_date=WEEK_B, kind="unplanned"),
        ]
    )
    session.commit()

    r = compute_stats(session, date_from=WEEK_A, date_to=WEEK_B + timedelta(days=4))
    by_serial = {a.serial: a for a in r.availability}
    a47 = by_serial["84047"]
    assert (a47.weekdays, a47.planned_down, a47.unplanned_down, a47.uptime_pct) == (10, 2, 2, 60.0)
    assert (by_serial["84098"].planned_down, by_serial["84098"].uptime_pct) == (0, 100.0)

    # Retrospective: a range running past today stops counting at today.
    future = utcnow().date() + timedelta(days=60)
    r = compute_stats(session, date_from=WEEK_A, date_to=future)
    assert r.availability[0].weekdays == compute_stats(session, date_from=WEEK_A, date_to=utcnow().date()).availability[0].weekdays

    # Instrument filter.
    assert [a.serial for a in compute_stats(session, instrument_serial="84098").availability] == ["84098"]
