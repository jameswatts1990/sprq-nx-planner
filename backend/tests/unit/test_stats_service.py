"""Aggregation math for stats_service.compute_stats, built directly against ORM rows so
statuses/dates that are awkward to reach through the API (completed cycles, failed uses,
window-breached cells, credit timestamps) can be set precisely."""
from datetime import date, datetime, timezone

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


def _instr(session, serial: str) -> int:
    return session.scalar(select(Instrument.id).where(Instrument.serial_number == serial))


def _run(session, instrument_id, run_date, status, movie_hours, uses):
    """uses: list of (cell, use_status, well)."""
    rb = RunBatch(instrument_id=instrument_id, run_date=run_date)
    session.add(rb)
    session.flush()
    cyc = Cycle(run_batch_id=rb.id, movie_hours=movie_hours, planned_start_at=DT, planned_end_at=DT, status=status)
    session.add(cyc)
    session.flush()
    for cell, use_status, well in uses:
        session.add(CellUse(cycle_id=cyc.id, cell_id=cell.id, well=well, status=use_status))
    session.flush()
    return cyc


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

    session.add_all([Sample(external_id="S1", status="backlog"), Sample(external_id="S2", status="backlog"),
                     Sample(external_id="S3", status="completed")])
    session.add(ImportBatch(raw_text="x", imported_count=5))
    session.commit()
    return session


def test_headline_and_throughput(seeded):
    r = compute_stats(seeded)
    h = r.headline
    assert h.runs_completed == 2  # two completed cycles (third is planned)
    assert h.samples_completed == 5  # completed cell-uses
    assert h.failure_rate == pytest.approx(16.7, abs=0.1)  # 1 failed / 6 verdicts
    assert h.well_fill_pct == pytest.approx(25.0)  # 6 filled / (3 runs * 8)
    assert h.avg_uses_per_cell == pytest.approx(2.5)  # terminal cells C1(3), C3(2)
    assert h.pct_reaching_use3 == pytest.approx(50.0)

    weeks = {p.week: p for p in r.throughput.series}
    assert weeks[WEEK_A].runs == 2 and weeks[WEEK_A].samples == 4
    assert weeks[WEEK_B].runs == 1 and weeks[WEEK_B].samples == 2
    assert {m.movie_hours: m.count for m in r.throughput.movie_hours_mix} == {12: 1, 24: 2}
    per = {p.serial: p for p in r.throughput.per_instrument}
    assert per["84047"].runs == 3 and per["84047"].cell_uses == 6
    assert per["84098"].runs == 0


def test_reuse_failures_inventory(seeded):
    r = compute_stats(seeded)
    depth = {d.uses: d.cells for d in r.reuse.depth_distribution}
    assert depth == {1: 0, 2: 1, 3: 1}
    assert r.reuse.window_waste.full_3_uses == 1
    assert r.reuse.window_waste.expired_early == 1

    outcomes = {o.status: o.count for o in r.failures.outcomes}
    assert outcomes == {"completed": 5, "failed": 1, "aborted": 0}

    funnel = r.failures.credit_funnel
    assert funnel.reported == 2 and funnel.awaiting == 1 and funnel.received == 1

    cell_status = {c.status: c.count for c in r.inventory.cell_status}
    assert cell_status == {"exhausted": 1, "open": 1, "window_expired": 1}
    sample_funnel = {s.status: s.count for s in r.inventory.sample_funnel}
    assert sample_funnel == {"backlog": 2, "completed": 1}
    assert sum(p.imported for p in r.inventory.import_volume) == 5


def test_date_range_excludes_out_of_window_runs(seeded):
    # Only week B is in range: two of the three runs drop out.
    r = compute_stats(seeded, date_from=WEEK_B, date_to=date(2026, 7, 17))
    assert {p.week for p in r.throughput.series} == {WEEK_B}
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
    assert r.throughput.per_instrument[0].runs == 1
    # C4 is the only cell on 84098; C1-C3 (pinned to 84047) are excluded from the snapshot
    assert {c.status: c.count for c in r.inventory.cell_status} == {"exhausted": 1}
