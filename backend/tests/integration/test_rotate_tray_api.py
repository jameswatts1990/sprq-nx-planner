"""Tray rotate (POST /api/cells/rotate-tray) and the discard-block recovery route
(POST /api/cell-uses/{id}/return-to-backlog).

Rotate replaces a physical tray with a fresh one from a given day: that day's uses and every
later use of the tray move onto new cells (restarting at Use 1), earlier uses stay on the old
(now discarded) cells as real history - unlike the old whole-tray discard, which cancelled
every planned use regardless of date and stranded earlier uses as un-removable "Blocked"
slots. The recovery route un-sticks exactly those discard-origin blocked slots."""
from datetime import date, timedelta


def _weekdays(n: int) -> list[str]:
    d = date.today() + timedelta(days=1)
    while d.weekday() != 0:  # anchor at the next Monday so N are genuinely consecutive
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


def _sid(client, pool_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["pool_id"] == pool_id)


def _sample(client, sample_id: int) -> dict:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s for s in items if s["id"] == sample_id)


def _place(client, sample_id, run_date, slot_index, cell_choice, instrument="84047"):
    return client.post(
        "/api/cell-uses",
        json={
            "sample_id": sample_id,
            "instrument_serial": instrument,
            "load_date": run_date,
            "slot_index": slot_index,
            "cell_choice": cell_choice,
            "run_time_hours": 24,
            "max_uses": 3,
        },
    )


def _confirm_loaded(client, cycle_id):
    return client.patch(f"/api/cycles/{cycle_id}", json={"status": "running"})


def _stage(cycle_json, well="A01"):
    return next(s for s in _stages(cycle_json) if s["well"] == well)


def test_discard_keeps_the_trigger_day_use_and_moves_only_strictly_later_uses(client):
    """Discard is "after this plate is loaded": a cell used Mon/Wed/Fri, discarded from Wed.
    Wednesday (the trigger day) STAYS on the current cell keeping its real Use 2 - only Friday,
    the strictly-later use, moves onto a fresh cell and restarts at Use 1. Monday stays Use 1.
    (Regression for "I discarded the plate and it turned to use one which should not have
    happened" - the trigger day used to move and wrongly reset to Use 1.)"""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2\nA3,bc3"})
    mon, _tue, wed, _thu, fri = _weekdays(5)

    r_mon = _place(client, _sid(client, "A1"), mon, 0, {"mode": "new"})
    assert r_mon.status_code == 201, r_mon.text
    old_cell_id = _stage(r_mon.json())["cell_id"]
    tray_id = _stage(r_mon.json())["tray_id"]
    mon_cycle_id = r_mon.json()["run_id"]

    r_wed = _place(client, _sid(client, "A2"), wed, 0, {"mode": "existing", "cell_id": old_cell_id})
    assert r_wed.status_code == 201, r_wed.text
    wed_cycle_id = r_wed.json()["run_id"]

    r_fri = _place(client, _sid(client, "A3"), fri, 0, {"mode": "existing", "cell_id": old_cell_id})
    assert r_fri.status_code == 201, r_fri.text
    fri_cycle_id = r_fri.json()["run_id"]

    # Sanity: one physical cell, Use 1/2/3 across the three days.
    assert _stage(r_wed.json())["use_number"] == 2
    assert _stage(r_fri.json())["use_number"] == 3

    resp = client.post("/api/cells/rotate-tray", json={"tray_id": tray_id, "from_date": wed})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["moved_count"] == 1  # only Friday (strictly after Wed) moves
    assert len(body["new_cells"]) == 4
    new_cell_id = next(c["id"] for c in body["new_cells"] if c["current_well"] == "A01")
    assert new_cell_id != old_cell_id

    # Monday + Wednesday (the trigger day): untouched, still their real Use 1 / Use 2 on the
    # old cell - Wednesday no longer moves or resets to Use 1.
    mon_stage = _stage(client.get(f"/api/cycles/{mon_cycle_id}").json())
    assert mon_stage["cell_id"] == old_cell_id
    assert mon_stage["use_number"] == 1
    assert mon_stage["cell_use_status"] == "planned"
    assert mon_stage["sample_pool_id"] == "A1"
    wed_stage = _stage(client.get(f"/api/cycles/{wed_cycle_id}").json())
    assert wed_stage["cell_id"] == old_cell_id
    assert wed_stage["use_number"] == 2
    assert wed_stage["cell_use_status"] == "planned"
    assert wed_stage["sample_pool_id"] == "A2"

    # Friday: the only strictly-later use, moved onto the fresh cell and renumbered to Use 1.
    fri_stage = _stage(client.get(f"/api/cycles/{fri_cycle_id}").json())
    assert fri_stage["cell_id"] == new_cell_id
    assert fri_stage["use_number"] == 1
    assert fri_stage["sample_pool_id"] == "A3"
    assert fri_stage["barcodes"] == ["bc3"]  # barcodes travel with the moved use

    # Old cell: discarded/exhausted, but keeps Monday's + Wednesday's uses as real history.
    old_cell = client.get(f"/api/cells/{old_cell_id}").json()
    assert old_cell["status"] == "exhausted"
    assert old_cell["discarded_at"] is not None
    assert old_cell["uses_consumed"] == 2

    # New cell: open with the single moved use.
    new_cell = client.get(f"/api/cells/{new_cell_id}").json()
    assert new_cell["status"] == "open"
    assert new_cell["uses_consumed"] == 1

    # No sample was bounced to the backlog - every one is still scheduled.
    assert client.get("/api/samples", params={"status": "backlog"}).json()["total"] == 0
    for ext in ("A1", "A2", "A3"):
        assert _sample(client, _sid(client, ext))["status"] == "scheduled"


def test_discard_re_homes_a_strictly_later_use_loaded_onto_a_differently_named_well(client):
    """Regression for the reported "Cell use in well D01 doesn't belong to this tray box." 409.

    A cell keeps its home well (its physical tray position) for life, but a CellUse.well is a
    plate LOADING position that legitimately differs from it - e.g. a tray that lands in cell-tray
    bay 1 (home wells A02-D02) yet loads onto a Plate-1 well (A01-D01). When a strictly-later use
    with such a divergent well moves during a discard, it must re-point onto the fresh tray by
    tray POSITION, not by matching the loading well against the new cells' home wells (which no
    longer contains it) - so it succeeds instead of 409ing."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nG1,bc1\nG2,bc2\nG3,bc3"})
    mon, tue, wed = _weekdays(3)

    # Occupy bay 0 so the next fresh tray is forced into bay 1 (home wells A02-D02).
    r1 = _place(client, _sid(client, "G1"), mon, 0, {"mode": "new"})
    assert r1.status_code == 201, r1.text

    # Drop G2 onto Plate-1 well D01 (slot 3): the fresh tray lands in bay 1, so its cell's home
    # well is A02 while the use loads into D01 - the loading-well != home-well split (Use 1, tue).
    r2 = _place(client, _sid(client, "G2"), tue, 3, {"mode": "new"})
    assert r2.status_code == 201, r2.text
    tue_stage = _stage(r2.json(), well="D01")
    assert tue_stage["cell_home_well"] == "A02"  # bay-1 tray's next-available cell...
    assert tue_stage["well"] == "D01"            # ...loaded onto a Plate-1 well (the divergence)
    bay1_cell_id = tue_stage["cell_id"]
    tray_id = tue_stage["tray_id"]
    tue_cycle_id = r2.json()["run_id"]

    # Reuse that same bay-1 cell on wed, again at D01 (Use 2) - the strictly-later use that will
    # move when we discard from tue.
    r3 = _place(client, _sid(client, "G3"), wed, 3, {"mode": "existing", "cell_id": bay1_cell_id})
    assert r3.status_code == 201, r3.text
    wed_cycle_id = r3.json()["run_id"]
    assert _stage(r3.json(), well="D01")["use_number"] == 2

    # Discard from tue: G2 (tue) stays, G3 (wed) moves. Before the fix the move 409'd "doesn't
    # belong to this tray box." because it looked the fresh cell up by the D01 loading well.
    resp = client.post("/api/cells/rotate-tray", json={"tray_id": tray_id, "from_date": tue})
    assert resp.status_code == 200, resp.text
    assert resp.json()["moved_count"] == 1

    # G2 (tue) stays put on the now-discarded bay-1 cell, keeping its Use 1 and D01 loading well.
    kept = _stage(client.get(f"/api/cycles/{tue_cycle_id}").json(), well="D01")
    assert kept["cell_id"] == bay1_cell_id
    assert kept["use_number"] == 1
    assert kept["well"] == "D01"
    old_cell = client.get(f"/api/cells/{bay1_cell_id}").json()
    assert old_cell["discarded_at"] is not None
    assert old_cell["uses_consumed"] == 1

    # G3 (wed) re-homed onto the fresh cell at the SAME tray position (home well A02), keeping
    # its D01 loading well and restarting at Use 1.
    new_cell_id = next(c["id"] for c in resp.json()["new_cells"] if c["current_well"] == "A02")
    assert new_cell_id != bay1_cell_id
    moved = _stage(client.get(f"/api/cycles/{wed_cycle_id}").json(), well="D01")
    assert moved["cell_id"] == new_cell_id
    assert moved["cell_home_well"] == "A02"
    assert moved["well"] == "D01"
    assert moved["use_number"] == 1
    assert _sample(client, _sid(client, "G3"))["status"] == "scheduled"


def test_discard_after_the_trays_last_use_keeps_it_and_mints_no_fresh_tray(client):
    """Discarding from the tray's only (last) use: nothing is strictly later, so nothing moves.
    The use stays put on its current cell keeping Use 1, the cells are marked discarded so
    nothing new reuses them, and NO fresh tray is minted (there's nothing to put on it)."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nB1,bc1"})
    (mon,) = _weekdays(1)

    r = _place(client, _sid(client, "B1"), mon, 0, {"mode": "new"})
    assert r.status_code == 201, r.text
    old_cell_id = _stage(r.json())["cell_id"]
    tray_id = _stage(r.json())["tray_id"]
    mon_cycle_id = r.json()["run_id"]

    resp = client.post("/api/cells/rotate-tray", json={"tray_id": tray_id, "from_date": mon})
    assert resp.status_code == 200, resp.text
    assert resp.json()["moved_count"] == 0
    assert resp.json()["new_cells"] == []  # nothing to move -> no fresh tray minted

    # The sample stays on its original cell at Use 1; the cell is now discarded (no future reuse).
    mon_stage = _stage(client.get(f"/api/cycles/{mon_cycle_id}").json())
    assert mon_stage["cell_id"] == old_cell_id
    assert mon_stage["use_number"] == 1
    assert mon_stage["cell_use_status"] == "planned"
    old_cell = client.get(f"/api/cells/{old_cell_id}").json()
    assert old_cell["status"] == "exhausted"
    assert old_cell["discarded_at"] is not None
    assert old_cell["uses_consumed"] == 1


def test_discard_rejected_when_a_strictly_later_use_is_confirmed_loaded(client):
    """A strictly-later use whose run is already confirmed loaded can't be moved (its cells are
    physically in the instrument) - discarding from an earlier day is rejected until it's
    unlocked. Discard from Monday while Wednesday's later reuse is confirmed loaded."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nC1,bc1\nC2,bc2"})
    mon, _tue, wed = _weekdays(3)

    r_mon = _place(client, _sid(client, "C1"), mon, 0, {"mode": "new"})
    old_cell_id = _stage(r_mon.json())["cell_id"]
    tray_id = _stage(r_mon.json())["tray_id"]
    r_wed = _place(client, _sid(client, "C2"), wed, 0, {"mode": "existing", "cell_id": old_cell_id})
    assert _confirm_loaded(client, r_wed.json()["run_id"]).status_code == 200

    resp = client.post("/api/cells/rotate-tray", json={"tray_id": tray_id, "from_date": mon})
    assert resp.status_code == 409
    assert "confirmed loaded" in resp.json()["detail"].lower()


def test_rotate_rejected_when_a_cell_in_the_tray_is_stopped(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nD1,bc1"})
    (mon,) = _weekdays(1)

    r = _place(client, _sid(client, "D1"), mon, 0, {"mode": "new"})
    cell_id = _stage(r.json())["cell_id"]
    tray_id = _stage(r.json())["tray_id"]
    use_id = _stage(r.json())["cell_use_id"]
    assert _confirm_loaded(client, r.json()["run_id"]).status_code == 200
    from tests.integration._qc_helpers import qc_stop

    stop = qc_stop(client, cell_id, use_id)
    assert stop.status_code == 200, stop.text

    resp = client.post("/api/cells/rotate-tray", json={"tray_id": tray_id, "from_date": mon})
    assert resp.status_code == 409
    assert "stopped" in resp.json()["detail"].lower()


def test_rotate_unknown_tray_is_404(client):
    (mon,) = _weekdays(1)
    resp = client.post("/api/cells/rotate-tray", json={"tray_id": 99999, "from_date": mon})
    assert resp.status_code == 404


def test_return_to_backlog_clears_a_discard_blocked_slot(client):
    """The recovery route for the reported bug's stuck state: a whole-tray discard (still
    used from the Cells page) cancelled Monday's earlier use too, leaving an un-removable
    "Blocked" slot. Return to backlog deletes it and confirms the sample is in the backlog."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nE1,bc1\nE2,bc2"})
    mon, _tue, wed = _weekdays(3)

    r_mon = _place(client, _sid(client, "E1"), mon, 0, {"mode": "new"})
    old_cell_id = _stage(r_mon.json())["cell_id"]
    tray_id = _stage(r_mon.json())["tray_id"]
    mon_use_id = _stage(r_mon.json())["cell_use_id"]
    r_wed = _place(client, _sid(client, "E2"), wed, 0, {"mode": "existing", "cell_id": old_cell_id})
    wed_use_id = _stage(r_wed.json())["cell_use_id"]

    # Old-style discard: cancels BOTH days' uses (the very bug), leaving Blocked slots.
    assert client.post("/api/cells/discard-tray", json={"tray_id": tray_id}).status_code == 200
    assert client.get(f"/api/cell-uses/{mon_use_id}").json()["status"] == "cancelled"

    resp = client.post(f"/api/cell-uses/{mon_use_id}/return-to-backlog")
    assert resp.status_code == 200, resp.text
    assert resp.json()["sample_id"] == _sid(client, "E1")

    # The dead placement is gone and its sample sits cleanly in the backlog.
    assert client.get(f"/api/cell-uses/{mon_use_id}").status_code == 404
    assert _sample(client, _sid(client, "E1"))["status"] == "backlog"

    # The other Blocked slot is independently recoverable too.
    assert client.post(f"/api/cell-uses/{wed_use_id}/return-to-backlog").status_code == 200
    assert client.get(f"/api/cell-uses/{wed_use_id}").status_code == 404


def test_return_to_backlog_rejects_a_stop_originated_block(client):
    """A cancellation from a QC Stop is a deliberate permanent marker (a dead well) - it
    must NOT be clearable this way, or the QC trail is lost. Told apart from a discard by the
    cell being 'stopped' (no discarded_at)."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nF1,bc1\nF2,bc2"})
    mon, _tue, wed = _weekdays(3)

    r_mon = _place(client, _sid(client, "F1"), mon, 0, {"mode": "new"})
    cell_id = _stage(r_mon.json())["cell_id"]
    mon_use_id = _stage(r_mon.json())["cell_use_id"]
    assert _confirm_loaded(client, r_mon.json()["run_id"]).status_code == 200
    r_wed = _place(client, _sid(client, "F2"), wed, 0, {"mode": "existing", "cell_id": cell_id})
    wed_use_id = _stage(r_wed.json())["cell_use_id"]

    # Discard the tray siblings so the stop has nowhere to re-home Wednesday's use onto - it
    # overflows to a permanent cancelled marker (the case this test is about).
    tray_id = client.get(f"/api/cells/{cell_id}").json()["tray_id"]
    for sib in [c["id"] for c in client.get("/api/cells", params={"tray_id": tray_id}).json()["items"] if c["id"] != cell_id]:
        client.post(f"/api/cells/{sib}/discard", json={"reason": "test"})

    # Fail-and-Stop from Monday's (running) use displaces Wednesday's later use to cancelled.
    from tests.integration._qc_helpers import qc_stop

    stop = qc_stop(client, cell_id, mon_use_id)
    assert stop.status_code == 200, stop.text
    assert client.get(f"/api/cell-uses/{wed_use_id}").json()["status"] == "cancelled"

    resp = client.post(f"/api/cell-uses/{wed_use_id}/return-to-backlog")
    assert resp.status_code == 409
    assert "stop cell" in resp.json()["detail"].lower()
