"""Restore a discarded tray (POST /api/cells/restore-tray): the inverse of the grid's ↻ "discard
current tray" (rotate_tray) and the Cells-page "Discard all cells" (discard_tray).

Restore always un-discards the tray's cells (making them reusable again) and, for a rotate discard,
reverses it - moving the moved uses back onto the old cells and deleting the emptied successor
tray, drift-guarded. A moved use that has since been confirmed loaded is left in place and reported
as drift; a successor tray now resident in the same bay is reported so the user resolves it."""
from datetime import date, timedelta


def _weekdays(n: int) -> list[str]:
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
    return [s for p in run["plates"] for s in p["stages"]]


def _stage(run, well="A01"):
    return next(s for s in _stages(run) if s["well"] == well)


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


def test_restore_after_rotate_reverses_it(client):
    """A cell used Mon (Use 1) + Wed (Use 2), the tray discarded from Monday (Wednesday's later
    use moved onto a fresh tray, restarting at Use 1). Restoring the tray moves Wednesday's use
    back onto the old cell (Use 2 again), deletes the now-empty successor tray, and re-opens the
    old cells."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nW1,bc1\nW2,bc2"})
    mon, _tue, wed = _weekdays(3)

    r1 = _place(client, _sid(client, "W1"), mon, 0, {"mode": "new"})
    old_cell_id = _stage(r1.json())["cell_id"]
    tray_id = _stage(r1.json())["tray_id"]
    r2 = _place(client, _sid(client, "W2"), wed, 0, {"mode": "existing", "cell_id": old_cell_id})
    wed_run_id = r2.json()["run_id"]
    assert _stage(r2.json())["use_number"] == 2

    # Discard the tray from Monday: Wednesday's later use moves onto a fresh tray as Use 1.
    rot = client.post("/api/cells/rotate-tray", json={"tray_id": tray_id, "from_date": mon})
    assert rot.status_code == 200, rot.text
    new_cell_id = next(c["id"] for c in rot.json()["new_cells"] if c["current_well"] == "A01")
    wed_after_rotate = _stage(client.get(f"/api/cycles/{wed_run_id}").json())
    assert wed_after_rotate["cell_id"] == new_cell_id
    assert wed_after_rotate["use_number"] == 1
    assert client.get(f"/api/cells/{old_cell_id}").json()["discarded_at"] is not None

    # Restore the tray: Wednesday's use returns to the old cell (Use 2), the successor tray is
    # deleted, and the old cells are open again.
    resp = client.post("/api/cells/restore-tray", json={"tray_id": tray_id})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["drifted_use_ids"] == []
    assert len(body["reversed_use_ids"]) == 1
    assert body["deleted_tray_id"] is not None
    assert body["bay_conflict_tray_id"] is None

    wed_restored = _stage(client.get(f"/api/cycles/{wed_run_id}").json())
    assert wed_restored["cell_id"] == old_cell_id
    assert wed_restored["use_number"] == 2
    old_cell = client.get(f"/api/cells/{old_cell_id}").json()
    assert old_cell["status"] == "open"
    assert old_cell["discarded_at"] is None
    assert old_cell["uses_consumed"] == 2
    # The successor tray's cell is gone.
    assert client.get(f"/api/cells/{new_cell_id}").status_code == 404


def test_restore_reports_drift_for_a_moved_use_since_confirmed_loaded(client):
    """After a rotate, if the moved (successor-tray) use has since been Confirm loaded, restore
    can't pull it back - it's reported as drift and left in place; the old cells are still
    un-discarded, and the successor tray (still holding that use) is kept."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nD1,bc1\nD2,bc2"})
    mon, _tue, wed = _weekdays(3)

    r1 = _place(client, _sid(client, "D1"), mon, 0, {"mode": "new"})
    old_cell_id = _stage(r1.json())["cell_id"]
    tray_id = _stage(r1.json())["tray_id"]
    r2 = _place(client, _sid(client, "D2"), wed, 0, {"mode": "existing", "cell_id": old_cell_id})
    wed_run_id = r2.json()["run_id"]

    rot = client.post("/api/cells/rotate-tray", json={"tray_id": tray_id, "from_date": mon})
    assert rot.status_code == 200, rot.text
    new_cell_id = next(c["id"] for c in rot.json()["new_cells"] if c["current_well"] == "A01")
    # Confirm-load Wednesday's run (now on the successor tray) - the moved use is physically in
    # the instrument, so it can't be pulled back.
    assert _confirm_loaded(client, wed_run_id).status_code == 200

    resp = client.post("/api/cells/restore-tray", json={"tray_id": tray_id})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["reversed_use_ids"] == []
    assert len(body["drifted_use_ids"]) == 1
    assert body["deleted_tray_id"] is None  # the successor tray still holds the confirmed use

    # The moved use stays on the successor tray; the old cells are re-opened regardless.
    assert _stage(client.get(f"/api/cycles/{wed_run_id}").json())["cell_id"] == new_cell_id
    assert client.get(f"/api/cells/{old_cell_id}").json()["discarded_at"] is None


def test_restore_reports_a_bay_conflict_when_a_successor_tray_took_the_bay(client):
    """A hard "Discard all cells" frees the tray's carousel bay, so a later fresh tray can load
    into it. Restoring the discarded tray re-opens its cells but reports the co-resident successor
    tray - two open trays in one bay is a physical impossibility the app won't silently resolve."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nB1,bc1\nB2,bc2"})
    mon, tue = _weekdays(2)

    r1 = _place(client, _sid(client, "B1"), mon, 0, {"mode": "new"})
    tray_a = _stage(r1.json())["tray_id"]

    # Hard-discard tray A (its cells go terminal, B1 back to the backlog), freeing bay 0.
    assert client.post("/api/cells/discard-tray", json={"tray_id": tray_a}).status_code == 200
    # A fresh tray B loads into the same bay for a Tuesday run.
    r2 = _place(client, _sid(client, "B2"), tue, 0, {"mode": "new"})
    tray_b = _stage(r2.json())["tray_id"]
    assert tray_b != tray_a

    resp = client.post("/api/cells/restore-tray", json={"tray_id": tray_a})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["bay_conflict_tray_id"] == tray_b
    # Tray A's cells are open again despite the conflict (the user resolves which tray stays).
    assert all(c["status"] == "open" and c["discarded_at"] is None for c in body["cells"])


def test_restore_refuses_a_tray_that_isnt_discarded(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nN1,bc1"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "N1"), mon, 0, {"mode": "new"})
    tray_id = _stage(r1.json())["tray_id"]
    resp = client.post("/api/cells/restore-tray", json={"tray_id": tray_id})
    assert resp.status_code == 409
    assert "isn't discarded" in resp.json()["detail"].lower()
