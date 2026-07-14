"""Instrument run-locking: a run locks its instrument for movie_hours + LOCK_BUFFER_HOURS
from its planned start. A *new* run on that instrument can't start before the prior lock
ends, but loading more samples into an *already-existing* run is never blocked by it -
and CycleOut/InstrumentOut both expose the derived lock state to the frontend."""
from datetime import date, timedelta, timezone

from app.models.schedule import Cycle, RunBatch


def _weekdays(n: int) -> list[str]:
    out: list[str] = []
    d = date.today()
    while len(out) < n:
        d += timedelta(days=1)
        if d.weekday() < 5:
            out.append(d.isoformat())
    return out


def _sid(client, external_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["external_id"] == external_id)


def _place(client, sample_id, run_date, slot_index=0, instrument="84047", run_time_hours=24, start_hour=None):
    payload = {
        "sample_id": sample_id,
        "instrument_serial": instrument,
        "run_date": run_date,
        "slot_index": slot_index,
        "cell_choice": {"mode": "new"},
        "run_time_hours": run_time_hours,
    }
    if start_hour is not None:
        payload["start_hour"] = start_hour
    return client.post("/api/cell-uses", json=payload)


def test_new_run_start_before_prior_lock_is_rejected(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    mon, tue = _weekdays(2)

    r1 = _place(client, _sid(client, "A1"), mon, run_time_hours=24)
    assert r1.status_code == 201, r1.text

    # Tuesday's default 9am start is well before Monday's lock (9am + 24h + 6h = next day 15:00)
    r2 = _place(client, _sid(client, "A2"), tue, run_time_hours=24)
    assert r2.status_code == 409, r2.text
    assert "locked" in r2.json()["detail"].lower()


def test_new_run_start_at_or_after_prior_lock_succeeds(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    mon, tue = _weekdays(2)

    r1 = _place(client, _sid(client, "A1"), mon, run_time_hours=24)
    assert r1.status_code == 201, r1.text

    r2 = _place(client, _sid(client, "A2"), tue, run_time_hours=24, start_hour=15)
    assert r2.status_code == 201, r2.text


def test_lock_lookback_finds_a_run_from_two_days_earlier(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    mon, tue, wed = _weekdays(3)

    # A 30h movie starting late (20:00) on Monday locks 84047 until Monday 20:00 + 36h = Wed 08:00.
    r1 = _place(client, _sid(client, "A1"), mon, run_time_hours=30, start_hour=20)
    assert r1.status_code == 201, r1.text

    # Wednesday morning (before 08:00) is still within that lock, even though it's two
    # calendar days after Monday - confirms the lookback isn't limited to "yesterday only".
    too_early = _place(client, _sid(client, "A2"), wed, run_time_hours=24, start_hour=7)
    assert too_early.status_code == 409, too_early.text
    assert "locked" in too_early.json()["detail"].lower()

    # Same instrument, same day, once the lock has actually elapsed - succeeds.
    late_enough = _place(client, _sid(client, "A2"), wed, run_time_hours=24, start_hour=8)
    assert late_enough.status_code == 201, late_enough.text


def test_loading_into_existing_run_never_blocked_by_its_own_lock(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    (mon,) = _weekdays(1)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0, run_time_hours=24)
    assert r1.status_code == 201, r1.text
    assert r1.json()["is_locked"] is False  # run_date is in the future relative to "now"

    # A second sample into the SAME (instrument, day) run, a different well - never gated
    # by the lock check, since it's not creating a new run.
    r2 = _place(client, _sid(client, "A2"), mon, slot_index=1, run_time_hours=24)
    assert r2.status_code == 201, r2.text
    assert r2.json()["cycle_id"] == r1.json()["cycle_id"]


def test_cycle_out_exposes_lock_until(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)

    r1 = _place(client, _sid(client, "A1"), mon, run_time_hours=24, start_hour=9)
    assert r1.status_code == 201, r1.text
    body = r1.json()

    # lock_until = planned_start_at (mon 09:00 UTC) + movie_hours (24) + LOCK_BUFFER_HOURS (6) = next calendar day 15:00
    next_day = (date.fromisoformat(mon) + timedelta(days=1)).isoformat()
    assert body["lock_until"].startswith(next_day)
    assert body["lock_until"].endswith("15:00:00Z") or body["lock_until"].endswith("15:00:00+00:00")


def test_instrument_out_reflects_a_currently_active_run(client, db_session):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "A1"), mon, run_time_hours=24)
    assert r1.status_code == 201, r1.text

    # Instruments list should show 84047 as not locked while the run is only planned/future.
    before = next(i for i in client.get("/api/instruments").json() if i["serial_number"] == "84047")
    assert before["is_locked"] is False
    assert before["locked_until"] is None

    # Directly backdate the cycle (and its run_date, which the lookback query filters on)
    # so "now" falls inside its window - simulating a run that actually started, without
    # needing to wait in real time.
    run_batch = db_session.query(RunBatch).filter_by(instrument_id=before["id"]).one()
    cycle = db_session.query(Cycle).filter_by(run_batch_id=run_batch.id).one()
    from app.timeutil import utcnow

    run_batch.run_date = utcnow().date()
    cycle.planned_start_at = utcnow() - timedelta(hours=1)
    cycle.planned_end_at = cycle.planned_start_at + timedelta(hours=cycle.movie_hours)
    cycle.status = "running"
    db_session.commit()

    after = next(i for i in client.get("/api/instruments").json() if i["serial_number"] == "84047")
    assert after["is_locked"] is True
    assert after["locked_until"] is not None


def test_instrument_out_ignores_aborted_runs_for_lock_state(client, db_session):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "A1"), mon, run_time_hours=24)
    instrument_id = next(i for i in client.get("/api/instruments").json() if i["serial_number"] == "84047")["id"]

    run_batch = db_session.query(RunBatch).filter_by(instrument_id=instrument_id).one()
    cycle = db_session.query(Cycle).filter_by(run_batch_id=run_batch.id).one()
    from app.timeutil import utcnow

    run_batch.run_date = utcnow().date()
    cycle.planned_start_at = utcnow() - timedelta(hours=1)
    cycle.planned_end_at = cycle.planned_start_at + timedelta(hours=cycle.movie_hours)
    cycle.status = "aborted"
    db_session.commit()

    after = next(i for i in client.get("/api/instruments").json() if i["serial_number"] == "84047")
    assert after["is_locked"] is False
