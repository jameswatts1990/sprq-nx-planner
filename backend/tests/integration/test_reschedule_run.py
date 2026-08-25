"""POST /api/cycles/{run_id}/reschedule: move a whole planned run (both plates) to another
weekday in one step - the "instrument failed to load, run it another day" flow. Each plate keeps
its cells/samples; only the day (and a reuse Plate 2's chained acquire day) changes. A reuse
pushed past its cell's 108h window comes back flagged reuse_window_exceeded (see the flag test in
test_move_endpoint.py), never silently re-trayed. See placement_service.reschedule_run."""
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
    return [s for p in run["plates"] for s in p["stages"]]


def _sid(client, pool_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["pool_id"] == pool_id)


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
        },
    )


def _confirm_loaded(client, run_id):
    return client.patch(f"/api/cycles/{run_id}", json={"status": "running"})


def test_reschedule_moves_the_whole_run_and_rechains_the_reuse_plate(client):
    """A run loaded Monday with a Plate 1 + an intra-run reuse Plate 2, rescheduled to the
    following Monday: both plates move together, Plate 1 acquires the new Monday, and the reuse
    Plate 2 re-chains off Plate 1's new movie end (still a later acquire day). Cells are unchanged
    - only the days move."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nR1,bc1\nR2,bc2"})
    mon, _tue, _wed, _thu, _fri, next_mon = _weekdays(6)

    r1 = _place(client, _sid(client, "R1"), mon, 0, {"mode": "new"})
    assert r1.status_code == 201, r1.text
    run_id = r1.json()["run_id"]
    cell_id = _stages(r1.json())[0]["cell_id"]

    # Reuse the same cell as an intra-run Plate 2 (slot 4), acquiring the day after Monday.
    r2 = _place(client, _sid(client, "R2"), mon, 4, {"mode": "existing", "cell_id": cell_id})
    assert r2.status_code == 201, r2.text
    run = client.get(f"/api/cycles/{run_id}").json()
    plate2 = next(p for p in run["plates"] if p["plate_index"] == 2)
    assert plate2["is_reuse"] is True
    assert plate2["acquire_date"] > mon

    resp = client.post(f"/api/cycles/{run_id}/reschedule", json={"new_load_date": next_mon})
    assert resp.status_code == 200, resp.text
    moved = resp.json()
    assert moved["load_date"] == next_mon
    p1 = next(p for p in moved["plates"] if p["plate_index"] == 1)
    p2 = next(p for p in moved["plates"] if p["plate_index"] == 2)
    assert p1["acquire_date"] == next_mon
    assert p2["is_reuse"] is True
    assert p2["acquire_date"] > next_mon  # reuse re-chained off the NEW Monday, not the old one
    # Same physical cells - a reschedule never reassigns them.
    assert _stages(moved)[0]["cell_id"] == cell_id
    # No sample was bounced to the backlog.
    assert client.get("/api/samples", params={"status": "backlog"}).json()["total"] == 0


def test_reschedule_refuses_a_confirmed_loaded_run(client):
    """A run whose cells are physically in the instrument (Confirm loaded) can't be rescheduled -
    unlock it first."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nC1,bc1"})
    mon, _tue, _wed, _thu, _fri, next_mon = _weekdays(6)
    r1 = _place(client, _sid(client, "C1"), mon, 0, {"mode": "new"})
    run_id = r1.json()["run_id"]
    assert _confirm_loaded(client, run_id).status_code == 200

    resp = client.post(f"/api/cycles/{run_id}/reschedule", json={"new_load_date": next_mon})
    assert resp.status_code == 409
    assert "confirmed loaded" in resp.json()["detail"].lower()


def test_reschedule_refuses_a_day_that_already_has_a_run(client):
    """Merging two runs onto one day isn't modelled - rescheduling onto a day the instrument
    already has a run is refused with a clear message."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nD1,bc1\nD2,bc2"})
    mon, tue, *_ = _weekdays(6)
    r_mon = _place(client, _sid(client, "D1"), mon, 0, {"mode": "new"})
    _place(client, _sid(client, "D2"), tue, 0, {"mode": "new"})  # occupies Tuesday

    resp = client.post(f"/api/cycles/{r_mon.json()['run_id']}/reschedule", json={"new_load_date": tue})
    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"].lower()


def test_reschedule_refuses_a_weekend(client):
    """Loads are weekday-only - rescheduling onto a Saturday is refused."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nE1,bc1"})
    (mon,) = _weekdays(1)
    saturday = (date.fromisoformat(mon) + timedelta(days=5)).isoformat()
    r1 = _place(client, _sid(client, "E1"), mon, 0, {"mode": "new"})
    resp = client.post(f"/api/cycles/{r1.json()['run_id']}/reschedule", json={"new_load_date": saturday})
    assert resp.status_code == 409
    assert "weekday" in resp.json()["detail"].lower()


def test_reschedule_past_the_window_flags_a_cross_run_reuse(client):
    """The reported bug: a reuse whose Use 1 was in an EARLIER, separate run (its 108h anchor
    fixed) gets rescheduled past the window. A self-contained run's own reuse can never go out of
    window on reschedule (its Use-1 anchor moves with it), so the out-of-window case is a cross-run
    reuse. Rescheduling it flags reuse_window_exceeded (flag, don't silently swap), not a block."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nF1,bc1\nF2,bc2"})
    mon, _tue, wed, _thu, _fri, next_mon = _weekdays(6)

    # F1 anchors the cell on Monday (its own run A).
    r1 = _place(client, _sid(client, "F1"), mon, 0, {"mode": "new"})
    cell_id = _stages(r1.json())[0]["cell_id"]

    # F2 reuses that cell in a separate run B on Wednesday (Use 2) - in window.
    r2 = _place(client, _sid(client, "F2"), wed, 0, {"mode": "existing", "cell_id": cell_id})
    run_b_id = r2.json()["run_id"]
    assert _stages(r2.json())[0]["reuse_window_exceeded"] is False

    # Reschedule run B a week out: its reuse now sits ~a week past Monday's fixed anchor, outside
    # 108h. It stays on its cell (a reschedule) and comes back flagged.
    resp = client.post(f"/api/cycles/{run_b_id}/reschedule", json={"new_load_date": next_mon})
    assert resp.status_code == 200, resp.text
    reuse = _stages(resp.json())[0]
    assert reuse["cell_id"] == cell_id
    assert reuse["use_number"] == 2
    assert reuse["reuse_window_exceeded"] is True
