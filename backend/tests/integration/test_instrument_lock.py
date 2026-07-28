"""Instrument run-locking: loading only one physical tray (<=4 wells, whichever bay)
locks the instrument for just LOCK_BUFFER_HOURS (a short loading/setup window); loading
both trays commits it to the full movie_hours + LOCK_BUFFER_HOURS. A *new* run on that
instrument can't start before the prior lock ends, but loading more samples into an
*already-existing* run is never blocked by it - and CycleOut/InstrumentOut both expose
the derived lock state to the frontend. See
docs/pacbio-sprq-nx-scheduling-reference.md's "Instrument load-lock timing" section."""
from datetime import date, timedelta, timezone

from app.models.schedule import Cycle, RunBatch


def _weekdays(n: int) -> list[str]:
    """The next n weekdays, always anchored at the next real Monday (never "today",
    matching the old behaviour of always being in the future) - guarantees n genuinely
    consecutive business days with no hidden weekend gap. Walking forward from "tomorrow"
    regardless of its weekday (the old implementation) could silently put 3+ calendar days
    between two "consecutive" entries whenever the walk crossed a weekend - e.g. tests
    anchor a 3-day lock lookback (LOOKBACK_DAYS=2) against a fixed calendar-day gap, and
    that broke whenever the suite ran on a Wednesday or later in the week."""
    d = date.today() + timedelta(days=1)
    while d.weekday() != 0:
        d += timedelta(days=1)
    out: list[str] = []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _stages(run):
    """All stages across a run's plates, flattened (plate 1 then plate 2). A single
    placement into slot 0-3 yields one plate; a fresh parallel/second-tray or reuse
    placement adds a second plate."""
    return [s for p in run["plates"] for s in p["stages"]]


def _sid(client, external_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["external_id"] == external_id)


def _place(client, sample_id, run_date, slot_index=0, instrument="84047", run_time_hours=24, start_hour=None, cell_choice=None):
    payload = {
        "sample_id": sample_id,
        "instrument_serial": instrument,
        "load_date": run_date,
        "slot_index": slot_index,
        "cell_choice": cell_choice or {"mode": "new"},
        "run_time_hours": run_time_hours,
    }
    if start_hour is not None:
        payload["start_hour"] = start_hour
    return client.post("/api/cell-uses", json=payload)


def _sibling_cell_id(client, tray_id, well):
    """An unused sibling cell (home_well == well) of an already-open tray - a "new"
    placement can't land at a well its own tray already occupies (see open_new_tray()'s
    box guard), so a same-box, different-well placement must reuse this sibling instead."""
    items = client.get("/api/cells", params={"tray_id": tray_id, "page_size": 10}).json()["items"]
    return next(c["id"] for c in items if c["current_well"] == well)


def test_single_tray_run_only_locks_for_the_short_setup_window(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    mon, tue = _weekdays(2)

    # Only tray 1 (slot 0) loaded on Monday - lock clears same day at noon + 6h = 18:00,
    # so Tuesday's default noon start is well past it and succeeds.
    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0, run_time_hours=24)
    assert r1.status_code == 201, r1.text
    cell_id_1 = _stages(r1.json())[0]["cell_id"]

    # Reuses Monday's cell for its Use 2 (well A01 is already that cell's own tray - see
    # open_new_tray()'s box guard) rather than opening a second, unrelated tray.
    r2 = _place(client, _sid(client, "A2"), tue, run_time_hours=24, cell_choice={"mode": "existing", "cell_id": cell_id_1})
    assert r2.status_code == 201, r2.text


def test_tray_2_only_run_also_only_locks_for_the_short_setup_window(client):
    """A run can start directly in tray 2's wells with tray 1 never touched that day -
    still just a one-tray touch point for lock purposes, same short window as loading
    tray 1 alone (see instrument_lock._both_trays_loaded - a naive "is tray 2 loaded at
    all" check would wrongly treat this as a full-movie lock)."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    mon, tue = _weekdays(2)

    # Only tray 2 (slot 4) loaded on Monday - lock clears same day at noon + 6h = 18:00,
    # so Tuesday's default noon start is well past it and succeeds.
    r1 = _place(client, _sid(client, "A1"), mon, slot_index=4, run_time_hours=24)
    assert r1.status_code == 201, r1.text
    cell_id_1 = _stages(r1.json())[0]["cell_id"]

    # Reuses Monday's cell for its Use 2 - stays pinned to well A02 (slot 4).
    r2 = _place(
        client, _sid(client, "A2"), tue, slot_index=4, run_time_hours=24, cell_choice={"mode": "existing", "cell_id": cell_id_1}
    )
    assert r2.status_code == 201, r2.text


def test_new_run_keeps_its_requested_start_when_the_loading_lock_clears_midday(client):
    """A prior run's loading-lock that clears *during* a day no longer silently BUMPS a new run's
    start - the user's chosen load time is recorded as-is (D1). And because Monday here used only
    2 of the 4 sequencing servers, the lane model says the Tuesday run genuinely CAN start at noon
    (the old bump to 18:00 was over-conservative), so no 'starts later' advisory fires. See
    placement_service.get_or_create_run / instrument_lock.effective_run_start."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2\nA3,bc3"})
    mon, tue = _weekdays(2)

    # Tray 1 (slot 0) and tray 2 (slot 4) both loaded on Monday at noon: the coarse loading-lock
    # would have said "locked until Tue 18:00", but only 2 sequencing servers are actually used.
    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0, run_time_hours=24)
    assert r1.status_code == 201, r1.text
    cell_id_1 = _stages(r1.json())[0]["cell_id"]
    r2 = _place(client, _sid(client, "A2"), mon, slot_index=4, run_time_hours=24)
    assert r2.status_code == 201, r2.text

    # Tuesday's default noon start is KEPT (not bumped to 18:00); the run reads as starting when
    # requested. Both of Monday's tray boxes are still loaded, so reuse tray 1's own cell for its
    # Use 2 (see open_new_tray()'s box guard) rather than opening a third tray.
    r3 = _place(client, _sid(client, "A3"), tue, run_time_hours=24, cell_choice={"mode": "existing", "cell_id": cell_id_1})
    assert r3.status_code == 201, r3.text
    body = r3.json()
    started_at = next(p for p in body["plates"] if p["acquire_date"] == tue)["planned_start_at"]
    assert started_at.startswith(tue) and "12:00" in started_at, started_at
    assert body["starts_later_than_requested"] is False


def test_new_run_rejected_on_a_day_the_lock_spans_in_full(client):
    """Only a lock that runs past the *end* of the load day (the instrument busy every hour
    of it) blocks a new run there - unlike a lock that clears mid-day (see above)."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2\nA3,bc3"})
    mon, tue = _weekdays(2)

    # A 30h movie starting late (20:00) Monday, both trays loaded, locks 84047 until
    # Monday 20:00 + 30h + 6h = Wednesday 08:00 - so all of Tuesday is inside the lock.
    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0, run_time_hours=30, start_hour=20)
    assert r1.status_code == 201, r1.text
    r2 = _place(client, _sid(client, "A2"), mon, slot_index=4, run_time_hours=30, start_hour=20)
    assert r2.status_code == 201, r2.text

    # Tuesday is fully occupied by the lock (it doesn't clear until Wednesday morning).
    r3 = _place(client, _sid(client, "A3"), tue, run_time_hours=24)
    assert r3.status_code == 409, r3.text
    assert "locked" in r3.json()["detail"].lower()


def test_two_tray_run_start_at_or_after_prior_lock_succeeds(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2\nA3,bc3"})
    mon, tue = _weekdays(2)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0, run_time_hours=24)
    assert r1.status_code == 201, r1.text
    cell_id_1 = _stages(r1.json())[0]["cell_id"]
    r2 = _place(client, _sid(client, "A2"), mon, slot_index=4, run_time_hours=24)
    assert r2.status_code == 201, r2.text

    # Both of 84047's tray boxes are already loaded from Monday - reuse tray 1's own cell
    # for its Use 2 (see open_new_tray()'s box guard) rather than opening a third tray.
    r3 = _place(
        client, _sid(client, "A3"), tue, run_time_hours=24, start_hour=18, cell_choice={"mode": "existing", "cell_id": cell_id_1}
    )
    assert r3.status_code == 201, r3.text


def test_lock_lookback_finds_a_two_tray_run_from_two_days_earlier(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2\nA3,bc3"})
    mon, tue, wed = _weekdays(3)

    # A 30h movie starting late (20:00) on Monday, both trays loaded, locks 84047 until
    # Monday 20:00 + 36h = Wed 08:00.
    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0, run_time_hours=30, start_hour=20)
    assert r1.status_code == 201, r1.text
    cell_id_1 = _stages(r1.json())[0]["cell_id"]
    r2 = _place(client, _sid(client, "A2"), mon, slot_index=4, run_time_hours=30, start_hour=20)
    assert r2.status_code == 201, r2.text

    # Wednesday's requested 07:00 start is KEPT as-is (D1: no silent bump to the old 08:00
    # lock-clear). Monday's 30h run used only 2 of the 4 sequencing servers, so Wednesday
    # genuinely has spare capacity and the run starts when asked. The load still SUCCEEDING (not
    # 409'd) confirms the 3-day lookback reached back two calendar days to find Monday's run.
    # Both tray boxes are already loaded, so reuse tray 1's own cell for its Use 2.
    r3 = _place(
        client, _sid(client, "A3"), wed, run_time_hours=24, start_hour=7, cell_choice={"mode": "existing", "cell_id": cell_id_1}
    )
    assert r3.status_code == 201, r3.text
    reuse_plate = next(p for p in r3.json()["plates"] if p["acquire_date"] == wed)
    assert reuse_plate["planned_start_at"].startswith(wed) and "07:00" in reuse_plate["planned_start_at"]
    assert r3.json()["starts_later_than_requested"] is False


def test_loading_onto_a_full_machine_keeps_the_time_but_advises_a_later_effective_start(client):
    """The heart of the lane-aware feature: load a run onto an instrument whose 4 sequencing
    servers are ALL busy, and the app records the user's chosen load time but tells them the cells
    won't actually break out until a server frees (starts_later_than_requested + effective_start_at).
    No blocking, no silent bump - just the honest effective start (cell_timing.instrument_timeline)."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,b1\nA2,b2\nA3,b3\nA4,b4\nA5,b5"})
    mon, tue = _weekdays(2)

    # Fill all 4 sequencing servers on Monday: a full tray of four 24h cells at noon (movies end
    # 28/30/32/34h from load). Slot 0 opens the tray; slots 1-3 fill its own sibling cells.
    r0 = _place(client, _sid(client, "A1"), mon, slot_index=0, run_time_hours=24)
    assert r0.status_code == 201, r0.text
    tray_id = _stages(r0.json())[0]["tray_id"]
    cell_id_1 = _stages(r0.json())[0]["cell_id"]
    for i, (ext, well) in enumerate([("A2", "B01"), ("A3", "C01"), ("A4", "D01")], start=1):
        sib = _sibling_cell_id(client, tray_id, well)
        r = _place(client, _sid(client, ext), mon, slot_index=i, run_time_hours=24, cell_choice={"mode": "existing", "cell_id": sib})
        assert r.status_code == 201, r.text

    # Tuesday noon: reuse cell A (its Use 2). Every server is busy until 28h+ (cell A's own frees
    # ~Tue 16:00), so the cells can't break out at noon - the response KEEPS the chosen noon load
    # but flags a later effective start. No block, no silent bump: just the honest timing.
    r = _place(client, _sid(client, "A5"), tue, slot_index=0, run_time_hours=24, cell_choice={"mode": "existing", "cell_id": cell_id_1})
    assert r.status_code == 201, r.text
    body = r.json()
    started_at = next(p for p in body["plates"] if p["acquire_date"] == tue)["planned_start_at"]
    assert started_at.startswith(tue) and "12:00" in started_at, started_at  # chosen load time kept
    assert body["starts_later_than_requested"] is True
    assert body["effective_start_at"] is not None
    assert body["effective_start_at"] > started_at  # cells actually break out later (a server frees ~Tue 16:00)


def test_loading_into_existing_run_never_blocked_by_its_own_lock(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    (mon,) = _weekdays(1)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0, run_time_hours=24)
    assert r1.status_code == 201, r1.text
    assert r1.json()["is_locked"] is False  # run_date is in the future relative to "now"
    tray_id = _stages(r1.json())[0]["tray_id"]

    # A second sample into the SAME (instrument, day) run, a different well - never gated
    # by the lock check, since it's not creating a new run. Reuses the tray's own unused
    # sibling at well B01 (see open_new_tray()'s box guard) rather than opening a new tray.
    sibling_id = _sibling_cell_id(client, tray_id, "B01")
    r2 = _place(
        client, _sid(client, "A2"), mon, slot_index=1, run_time_hours=24, cell_choice={"mode": "existing", "cell_id": sibling_id}
    )
    assert r2.status_code == 201, r2.text
    assert r2.json()["run_id"] == r1.json()["run_id"]


def test_cycle_out_exposes_lock_until_for_tray_1_only(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0, run_time_hours=24, start_hour=9)
    assert r1.status_code == 201, r1.text
    body = r1.json()

    # Only tray 1 loaded: lock_until = planned_start_at (mon 09:00 UTC) + LOCK_BUFFER_HOURS (6) = same day 15:00
    assert body["lock_until"].startswith(mon)
    assert body["lock_until"].endswith("15:00:00Z") or body["lock_until"].endswith("15:00:00+00:00")


def test_cycle_out_exposes_lock_until_for_both_trays(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    (mon,) = _weekdays(1)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0, run_time_hours=24, start_hour=9)
    assert r1.status_code == 201, r1.text
    r2 = _place(client, _sid(client, "A2"), mon, slot_index=4, run_time_hours=24, start_hour=9)
    assert r2.status_code == 201, r2.text
    body = r2.json()

    # Both trays loaded: lock_until = planned_start_at (mon 09:00 UTC) + movie_hours (24) + LOCK_BUFFER_HOURS (6) = next calendar day 15:00
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

    # Directly backdate the run (its load_date) and the plate (its acquire_date, which the
    # lookback query filters on, and planned_start_at) so "now" falls inside its window -
    # simulating a run that actually started, without needing to wait in real time.
    run_batch = db_session.query(RunBatch).filter_by(instrument_id=before["id"]).one()
    cycle = db_session.query(Cycle).filter_by(run_batch_id=run_batch.id).one()
    from app.timeutil import utcnow

    run_batch.load_date = utcnow().date()
    cycle.acquire_date = utcnow().date()
    cycle.planned_start_at = utcnow() - timedelta(hours=1)
    cycle.planned_end_at = cycle.planned_start_at + timedelta(hours=cycle.movie_hours)
    cycle.status = "running"
    db_session.commit()

    after = next(i for i in client.get("/api/instruments").json() if i["serial_number"] == "84047")
    assert after["is_locked"] is True
    assert after["locked_until"] is not None


def test_latest_lock_until_ignores_a_completed_run_from_the_lookback_window(client, db_session):
    """A completed run's real-world outcome is already known - the instrument's true
    future availability should follow that known outcome, not a hypothetical projection
    from planned_start_at + movie_hours. Mirrors currently_locked_cycle's own exclusion of
    completed/aborted cycles (see test_instrument_out_ignores_aborted_runs_for_lock_state),
    but for the separate latest_lock_until check that gates *creating a new run*."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2\nA3,bc3"})
    mon, _tue, wed = _weekdays(3)

    # A 30h movie starting late (20:00) on Monday, both trays loaded - would otherwise lock
    # 84047 until Monday 20:00 + 36h = Wed 08:00 (see
    # test_lock_lookback_finds_a_two_tray_run_from_two_days_earlier).
    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0, run_time_hours=30, start_hour=20)
    assert r1.status_code == 201, r1.text
    cell_id_1 = _stages(r1.json())[0]["cell_id"]
    r2 = _place(client, _sid(client, "A2"), mon, slot_index=4, run_time_hours=30, start_hour=20)
    assert r2.status_code == 201, r2.text
    run_id = r1.json()["run_id"]

    # Mark the whole run (both loaded plates) completed - a run's real-world outcome is
    # recorded across all its plates together.
    for cyc in db_session.query(Cycle).filter_by(run_batch_id=run_id).all():
        cyc.status = "completed"
    db_session.commit()

    # Wednesday morning, still well within the old (now-irrelevant) projected lock window.
    # Both tray boxes are already loaded from Monday, so reuse tray 1's own cell for its
    # Use 2 (see open_new_tray()'s box guard) rather than opening a third tray.
    resp = _place(
        client, _sid(client, "A3"), wed, run_time_hours=24, start_hour=7, cell_choice={"mode": "existing", "cell_id": cell_id_1}
    )
    assert resp.status_code == 201, resp.text


def test_latest_lock_until_ignores_an_aborted_run_from_the_lookback_window(client, db_session):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2\nA3,bc3"})
    mon, _tue, wed = _weekdays(3)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0, run_time_hours=30, start_hour=20)
    assert r1.status_code == 201, r1.text
    cell_id_1 = _stages(r1.json())[0]["cell_id"]
    r2 = _place(client, _sid(client, "A2"), mon, slot_index=4, run_time_hours=30, start_hour=20)
    assert r2.status_code == 201, r2.text
    run_id = r1.json()["run_id"]

    # Mark the whole run (both loaded plates) aborted.
    for cyc in db_session.query(Cycle).filter_by(run_batch_id=run_id).all():
        cyc.status = "aborted"
    db_session.commit()

    # Both tray boxes are already loaded from Monday, so reuse tray 1's own cell for its
    # Use 2 (see open_new_tray()'s box guard) rather than opening a third tray.
    resp = _place(
        client, _sid(client, "A3"), wed, run_time_hours=24, start_hour=7, cell_choice={"mode": "existing", "cell_id": cell_id_1}
    )
    assert resp.status_code == 201, resp.text


def test_instrument_out_ignores_aborted_runs_for_lock_state(client, db_session):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "A1"), mon, run_time_hours=24)
    instrument_id = next(i for i in client.get("/api/instruments").json() if i["serial_number"] == "84047")["id"]

    run_batch = db_session.query(RunBatch).filter_by(instrument_id=instrument_id).one()
    cycle = db_session.query(Cycle).filter_by(run_batch_id=run_batch.id).one()
    from app.timeutil import utcnow

    run_batch.load_date = utcnow().date()
    cycle.acquire_date = utcnow().date()
    cycle.planned_start_at = utcnow() - timedelta(hours=1)
    cycle.planned_end_at = cycle.planned_start_at + timedelta(hours=cycle.movie_hours)
    cycle.status = "aborted"
    db_session.commit()

    after = next(i for i in client.get("/api/instruments").json() if i["serial_number"] == "84047")
    assert after["is_locked"] is False


def test_run_reads_as_running_through_its_whole_acquisition_window_not_just_the_loading_lock(client, db_session):
    """Regression: a single-tray run sequences for ~30h, but its LOADING-lock clears after only
    LOCK_BUFFER_HOURS (6h) - that's when the *next* run can load, not when this one stops running.
    Deriving is_locked / the "currently running" state from the loading-lock made a run that was
    still mid-movie read as idle ~6h in, with a blank instrument gantt. is_locked / instrument
    state now follow the per-cell acquisition window (cell_timing.run_is_acquiring)."""
    from app.timeutil import utcnow

    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "A1"), mon, run_time_hours=24)
    run_id = r1.json()["run_id"]

    # Backdate to 10h ago: PAST the 6h loading-lock, but well inside the ~34h (4h prep + 24h movie
    # + 6h PPA) acquisition window - the exact gap the bug fell into.
    run_batch = db_session.query(RunBatch).filter_by(id=run_id).one()
    cycle = db_session.query(Cycle).filter_by(run_batch_id=run_id).one()
    run_batch.load_date = utcnow().date()
    cycle.acquire_date = utcnow().date()
    cycle.planned_start_at = utcnow() - timedelta(hours=10)
    cycle.planned_end_at = cycle.planned_start_at + timedelta(hours=cycle.movie_hours)
    cycle.status = "running"
    db_session.commit()

    run = client.get(f"/api/cycles/{run_id}").json()
    # The loading-lock (lock_until) has already cleared (start + 6h = 4h ago) - proving is_locked
    # is no longer tied to it - yet the run still reads as actively running.
    assert run["lock_until"] < utcnow().isoformat()
    assert run["is_locked"] is True

    inst = next(i for i in client.get("/api/instruments").json() if i["serial_number"] == "84047")
    assert inst["is_locked"] is True
    assert inst["locked_until"] > utcnow().isoformat()  # acquisition end is still in the future

    stats = next(s for s in client.get("/api/instruments/stats").json() if s["serial_number"] == "84047")
    assert stats["running_run_name"] == f"#{run_id}"
    assert stats["cells_sequencing"] == 1  # 10h in: past 4h prep, inside the 24h movie


def test_acquisition_window_anchors_on_the_real_confirm_load_time_not_the_plan(client, db_session):
    """"Loading time = the time entered at Confirm loaded." A run confirmed-loaded far later than
    it was planned is timed from its actual_start_at: even when the *planned* window has long
    since lapsed, the run reads as running if its real load puts "now" inside the acquisition
    window (and vice-versa). This is what keeps the gantt and the live state honest."""
    from app.timeutil import utcnow

    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)
    run_id = _place(client, _sid(client, "A1"), mon, run_time_hours=24).json()["run_id"]

    run_batch = db_session.query(RunBatch).filter_by(id=run_id).one()
    cycle = db_session.query(Cycle).filter_by(run_batch_id=run_id).one()
    run_batch.load_date = utcnow().date()
    cycle.acquire_date = utcnow().date()
    # Planned 40h ago: a window anchored on the plan (40h > the ~34h span) would read as finished.
    cycle.planned_start_at = utcnow() - timedelta(hours=40)
    cycle.planned_end_at = cycle.planned_start_at + timedelta(hours=cycle.movie_hours)
    # But it was actually loaded only 10h ago - so it IS still running.
    cycle.actual_start_at = utcnow() - timedelta(hours=10)
    cycle.status = "running"
    db_session.commit()

    run = client.get(f"/api/cycles/{run_id}").json()
    assert run["is_locked"] is True  # anchored on actual_start_at (10h ago), not planned (40h ago)
