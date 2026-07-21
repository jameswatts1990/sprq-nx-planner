"""_resolve_cell_choice's chronological-order guard (placement_service.py): a sample can
be placed onto a cell's earlier, still-open well ahead of that same cell's already-
scheduled *later* use - inserting a new use, never removing the later one. Use numbering
is derived live by run_date order (run_serializer._use_number), so the later use simply
renumbers to a higher Use N on the next read. This is only safe while that later use is
still pure planning (docs/pacbio-sprq-nx-scheduling-reference.md #4: reuse must stay
strictly sequential once a use has actually started in the lab) - the guard rejects the
insert once the displaced use's cycle has been confirmed loaded ("running" or later)."""
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


def _sid(client, external_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["external_id"] == external_id)


def _place(client, sample_id, run_date, slot_index=0, cell_choice=None, instrument="84047", start_hour=None):
    payload = {
        "sample_id": sample_id,
        "instrument_serial": instrument,
        "run_date": run_date,
        "slot_index": slot_index,
        "cell_choice": cell_choice or {"mode": "new"},
        "run_time_hours": 24,
    }
    if start_hour is not None:
        payload["start_hour"] = start_hour
    return client.post("/api/cell-uses", json=payload)


def _confirm(client, cycle_id):
    resp = client.patch(f"/api/cycles/{cycle_id}", json={"status": "running"})
    assert resp.status_code == 200, resp.text
    return resp


def test_insert_earlier_use_succeeds_and_renumbers_the_later_use(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2\nA3,bc3"})
    mon, tue, wed = _weekdays(3)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_id = r1.json()["stages"][0]["cell_id"]
    r2 = _place(client, _sid(client, "A2"), wed, slot_index=0, cell_choice={"mode": "existing", "cell_id": cell_id}, start_hour=15)
    assert r2.status_code == 201, r2.text
    wed_cycle_id = r2.json()["cycle_id"]

    r3 = _place(client, _sid(client, "A3"), tue, slot_index=0, cell_choice={"mode": "existing", "cell_id": cell_id}, start_hour=15)
    assert r3.status_code == 201, r3.text
    tue_stage = r3.json()["stages"][0]
    assert tue_stage["sample_external_id"] == "A3"
    assert tue_stage["use_number"] == 2

    wed_cycle = client.get(f"/api/cycles/{wed_cycle_id}").json()
    wed_stage = wed_cycle["stages"][0]
    assert wed_stage["sample_external_id"] == "A2"
    assert wed_stage["use_number"] == 3  # bumped up, never removed

    assert client.get(f"/api/cells/{cell_id}").json()["uses_consumed"] == 3


def test_insert_earlier_use_rejected_once_the_later_use_has_started(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2\nA3,bc3"})
    mon, tue, wed = _weekdays(3)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_id = r1.json()["stages"][0]["cell_id"]
    r2 = _place(client, _sid(client, "A2"), wed, slot_index=0, cell_choice={"mode": "existing", "cell_id": cell_id}, start_hour=15)
    _confirm(client, r2.json()["cycle_id"])  # Wednesday's use is now locked in - no longer pure planning

    r3 = _place(client, _sid(client, "A3"), tue, slot_index=0, cell_choice={"mode": "existing", "cell_id": cell_id}, start_hour=15)
    assert r3.status_code == 409, r3.text
    assert "started" in r3.json()["detail"].lower()

    # nothing changed
    assert client.get(f"/api/cells/{cell_id}").json()["uses_consumed"] == 2


def test_insert_rejected_when_the_cells_only_use_so_far_has_already_started(client):
    """The general loop, not just "the next use": here the *earliest* (and only) use is
    the one that's started, and the insert targets a day before it."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    mon, _tue, wed = _weekdays(3)

    r1 = _place(client, _sid(client, "A1"), wed, slot_index=0)
    cell_id = r1.json()["stages"][0]["cell_id"]
    _confirm(client, r1.json()["cycle_id"])

    r2 = _place(client, _sid(client, "A2"), mon, slot_index=0, cell_choice={"mode": "existing", "cell_id": cell_id})
    assert r2.status_code == 409, r2.text
    assert "started" in r2.json()["detail"].lower()


def test_insert_still_rejected_on_a_fully_booked_cell_via_the_pre_existing_status_check(client):
    """A cell with all 3 uses already scheduled (still planned) has no remaining capacity
    to insert into at all - consuming its last use flips its derived status straight to
    "exhausted" (recompute_status), so the pre-existing `cell.status != "open"` check
    catches this before the new chronological guard ever runs, unaffected by it."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2\nA3,bc3\nA4,bc4"})
    mon, tue, wed, thu = _weekdays(4)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_id = r1.json()["stages"][0]["cell_id"]
    _place(client, _sid(client, "A2"), wed, slot_index=0, cell_choice={"mode": "existing", "cell_id": cell_id}, start_hour=15)
    _place(client, _sid(client, "A3"), thu, slot_index=0, cell_choice={"mode": "existing", "cell_id": cell_id}, start_hour=15)
    assert client.get(f"/api/cells/{cell_id}").json()["uses_remaining"] == 0

    r4 = _place(client, _sid(client, "A4"), tue, slot_index=0, cell_choice={"mode": "existing", "cell_id": cell_id})
    assert r4.status_code == 409, r4.text
    assert "exhausted" in r4.json()["detail"].lower()
