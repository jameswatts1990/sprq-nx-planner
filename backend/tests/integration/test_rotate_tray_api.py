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


def _sid(client, external_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["external_id"] == external_id)


def _sample(client, sample_id: int) -> dict:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s for s in items if s["id"] == sample_id)


def _place(client, sample_id, run_date, slot_index, cell_choice, instrument="84047"):
    return client.post(
        "/api/cell-uses",
        json={
            "sample_id": sample_id,
            "instrument_serial": instrument,
            "run_date": run_date,
            "slot_index": slot_index,
            "cell_choice": cell_choice,
            "run_time_hours": 24,
            "max_uses": 3,
        },
    )


def _confirm_loaded(client, cycle_id):
    return client.patch(f"/api/cycles/{cycle_id}", json={"status": "running"})


def _stage(cycle_json, well="A01"):
    return next(s for s in cycle_json["stages"] if s["well"] == well)


def test_rotate_moves_trigger_day_and_later_uses_to_a_fresh_tray_keeping_earlier_history(client):
    """The reported bug scenario, plus a Use 3: a cell used Mon/Wed/Fri, rotated on Wed.
    Wed+Fri move onto a fresh cell (Use 1, Use 2); Monday stays a normal Use 1 on the old
    (now discarded) cell - never turned into a "Blocked" slot."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2\nA3,bc3"})
    mon, _tue, wed, _thu, fri = _weekdays(5)

    r_mon = _place(client, _sid(client, "A1"), mon, 0, {"mode": "new"})
    assert r_mon.status_code == 201, r_mon.text
    old_cell_id = _stage(r_mon.json())["cell_id"]
    tray_id = _stage(r_mon.json())["tray_id"]
    mon_cycle_id = r_mon.json()["cycle_id"]

    r_wed = _place(client, _sid(client, "A2"), wed, 0, {"mode": "existing", "cell_id": old_cell_id})
    assert r_wed.status_code == 201, r_wed.text
    wed_cycle_id = r_wed.json()["cycle_id"]

    r_fri = _place(client, _sid(client, "A3"), fri, 0, {"mode": "existing", "cell_id": old_cell_id})
    assert r_fri.status_code == 201, r_fri.text
    fri_cycle_id = r_fri.json()["cycle_id"]

    # Sanity: one physical cell, Use 1/2/3 across the three days.
    assert _stage(r_wed.json())["use_number"] == 2
    assert _stage(r_fri.json())["use_number"] == 3

    resp = client.post("/api/cells/rotate-tray", json={"tray_id": tray_id, "from_date": wed})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["moved_count"] == 2
    assert len(body["new_cells"]) == 4
    new_cell_id = next(c["id"] for c in body["new_cells"] if c["current_well"] == "A01")
    assert new_cell_id != old_cell_id

    # Monday: untouched, still a normal (non-cancelled) Use 1 on the old cell.
    mon_stage = _stage(client.get(f"/api/cycles/{mon_cycle_id}").json())
    assert mon_stage["cell_id"] == old_cell_id
    assert mon_stage["use_number"] == 1
    assert mon_stage["cell_use_status"] == "planned"
    assert mon_stage["sample_external_id"] == "A1"

    # Wednesday (the rotate day) + Friday: moved onto the fresh cell, renumbered from Use 1.
    wed_stage = _stage(client.get(f"/api/cycles/{wed_cycle_id}").json())
    assert wed_stage["cell_id"] == new_cell_id
    assert wed_stage["use_number"] == 1
    assert wed_stage["sample_external_id"] == "A2"
    assert wed_stage["barcodes"] == ["bc2"]  # barcodes travel with the moved use
    fri_stage = _stage(client.get(f"/api/cycles/{fri_cycle_id}").json())
    assert fri_stage["cell_id"] == new_cell_id
    assert fri_stage["use_number"] == 2

    # Old cell: discarded/exhausted, but keeps Monday's use as real history.
    old_cell = client.get(f"/api/cells/{old_cell_id}").json()
    assert old_cell["status"] == "exhausted"
    assert old_cell["discarded_at"] is not None
    assert old_cell["uses_consumed"] == 1

    # New cell: open with the two moved uses.
    new_cell = client.get(f"/api/cells/{new_cell_id}").json()
    assert new_cell["status"] == "open"
    assert new_cell["uses_consumed"] == 2

    # No sample was bounced to the backlog - every one is still scheduled.
    assert client.get("/api/samples", params={"status": "backlog"}).json()["total"] == 0
    for ext in ("A1", "A2", "A3"):
        assert _sample(client, _sid(client, ext))["status"] == "scheduled"


def test_rotate_on_the_trays_first_day_deletes_the_emptied_old_tray(client):
    """Rotating on the tray's very first scheduled day moves every use off it - the old tray
    keeps no history, so it's removed rather than left as an empty discarded ghost."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nB1,bc1"})
    (mon,) = _weekdays(1)

    r = _place(client, _sid(client, "B1"), mon, 0, {"mode": "new"})
    assert r.status_code == 201, r.text
    old_cell_id = _stage(r.json())["cell_id"]
    tray_id = _stage(r.json())["tray_id"]
    mon_cycle_id = r.json()["cycle_id"]

    resp = client.post("/api/cells/rotate-tray", json={"tray_id": tray_id, "from_date": mon})
    assert resp.status_code == 200, resp.text
    assert resp.json()["moved_count"] == 1

    # Old cell (and its whole emptied tray) is gone; the sample now sits on a fresh cell.
    assert client.get(f"/api/cells/{old_cell_id}").status_code == 404
    mon_stage = _stage(client.get(f"/api/cycles/{mon_cycle_id}").json())
    assert mon_stage["cell_id"] != old_cell_id
    assert mon_stage["use_number"] == 1


def test_rotate_rejected_when_a_use_on_or_after_the_day_is_confirmed_loaded(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nC1,bc1\nC2,bc2"})
    mon, _tue, wed = _weekdays(3)

    r_mon = _place(client, _sid(client, "C1"), mon, 0, {"mode": "new"})
    old_cell_id = _stage(r_mon.json())["cell_id"]
    tray_id = _stage(r_mon.json())["tray_id"]
    r_wed = _place(client, _sid(client, "C2"), wed, 0, {"mode": "existing", "cell_id": old_cell_id})
    assert _confirm_loaded(client, r_wed.json()["cycle_id"]).status_code == 200

    resp = client.post("/api/cells/rotate-tray", json={"tray_id": tray_id, "from_date": wed})
    assert resp.status_code == 409
    assert "confirmed loaded" in resp.json()["detail"].lower()


def test_rotate_rejected_when_a_cell_in_the_tray_is_stopped(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nD1,bc1"})
    (mon,) = _weekdays(1)

    r = _place(client, _sid(client, "D1"), mon, 0, {"mode": "new"})
    cell_id = _stage(r.json())["cell_id"]
    tray_id = _stage(r.json())["tray_id"]
    use_id = _stage(r.json())["cell_use_id"]
    assert _confirm_loaded(client, r.json()["cycle_id"]).status_code == 200
    stop = client.post(f"/api/cells/{cell_id}/stop", json={"reason": "crack", "cell_use_id": use_id})
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
    assert _confirm_loaded(client, r_mon.json()["cycle_id"]).status_code == 200
    r_wed = _place(client, _sid(client, "F2"), wed, 0, {"mode": "existing", "cell_id": cell_id})
    wed_use_id = _stage(r_wed.json())["cell_use_id"]

    # Stop from Monday's (running) use cascades Wednesday's later use to cancelled.
    stop = client.post(f"/api/cells/{cell_id}/stop", json={"reason": "crack", "cell_use_id": mon_use_id})
    assert stop.status_code == 200, stop.text
    assert client.get(f"/api/cell-uses/{wed_use_id}").json()["status"] == "cancelled"

    resp = client.post(f"/api/cell-uses/{wed_use_id}/return-to-backlog")
    assert resp.status_code == 409
    assert "stop cell" in resp.json()["detail"].lower()
