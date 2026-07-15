"""POST /api/cell-uses/{id}/change-cell: reassign an already-placed sample to a
different cell, same slot - the orthogonal counterpart to /move (which changes day/slot
but always keeps the same cell)."""
from datetime import date, timedelta


def _weekdays(n: int) -> list[str]:
    """The next n weekdays, always anchored at the next real Monday (never "today") -
    guarantees n genuinely consecutive business days with no hidden weekend gap. Walking
    forward from "tomorrow" regardless of its weekday could silently put 3+ calendar days
    between two "consecutive" entries whenever the walk crossed a weekend."""
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


def _change_cell(client, cell_use_id, cell_choice):
    return client.post(f"/api/cell-uses/{cell_use_id}/change-cell", json={"cell_choice": cell_choice})


def _bootstrap(client, instrument_serial="84047", uses_consumed=0, burned_barcodes=None):
    payload = {
        "uses_consumed": uses_consumed,
        "burned_barcodes": burned_barcodes or [],
        "instrument_serial": instrument_serial,
    }
    resp = client.post("/api/cells/bootstrap", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_change_cell_swaps_to_an_existing_compatible_cell(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    mon, tue = _weekdays(2)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_use_id = r1.json()["stages"][0]["cell_use_id"]
    old_cell_id = r1.json()["stages"][0]["cell_id"]

    r2 = _place(client, _sid(client, "A2"), tue, slot_index=0, start_hour=15)
    new_cell_id = r2.json()["stages"][0]["cell_id"]

    resp = _change_cell(client, cell_use_id, {"mode": "existing", "cell_id": new_cell_id})
    assert resp.status_code == 200, resp.text
    stage = resp.json()["stages"][0]
    assert stage["cell_use_id"] == cell_use_id
    assert stage["cell_id"] == new_cell_id
    # the placement never moved day/slot/sample - only the cell changed
    assert resp.json()["run_date"] == mon
    assert stage["sample_external_id"] == "A1"

    # the vacated cell had no other uses, so it must not be left behind as an orphan
    assert client.get(f"/api/cells/{old_cell_id}").status_code == 404
    new_cell = client.get(f"/api/cells/{new_cell_id}").json()
    assert new_cell["uses_consumed"] == 2
    assert set(new_cell["burned_barcodes"]) == {"bc1", "bc2"}


def test_change_cell_to_a_brand_new_cell(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_use_id = r1.json()["stages"][0]["cell_use_id"]
    old_cell_id = r1.json()["stages"][0]["cell_id"]

    resp = _change_cell(client, cell_use_id, {"mode": "new"})
    assert resp.status_code == 200, resp.text
    new_cell_id = resp.json()["stages"][0]["cell_id"]
    assert new_cell_id != old_cell_id

    assert client.get(f"/api/cells/{old_cell_id}").status_code == 404
    new_cell = client.get(f"/api/cells/{new_cell_id}").json()
    assert new_cell["uses_consumed"] == 1
    assert new_cell["burned_barcodes"] == ["bc1"]


def test_change_cell_keeps_old_cell_alive_when_it_still_has_other_uses(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2\nA3,bc3"})
    mon, tue, wed = _weekdays(3)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    shared_cell_id = r1.json()["stages"][0]["cell_id"]
    r2 = _place(client, _sid(client, "A2"), tue, slot_index=0, cell_choice={"mode": "existing", "cell_id": shared_cell_id}, start_hour=15)
    cell_use_id_2 = r2.json()["stages"][0]["cell_use_id"]

    r3 = _place(client, _sid(client, "A3"), wed, slot_index=0, start_hour=15)
    other_cell_id = r3.json()["stages"][0]["cell_id"]

    resp = _change_cell(client, cell_use_id_2, {"mode": "existing", "cell_id": other_cell_id})
    assert resp.status_code == 200, resp.text

    # A1's use is still on the shared cell, so it must survive with the correct derived count
    shared_cell = client.get(f"/api/cells/{shared_cell_id}").json()
    assert shared_cell["status"] == "open"
    assert shared_cell["uses_consumed"] == 1
    assert shared_cell["burned_barcodes"] == ["bc1"]


def test_change_cell_no_op_when_target_is_the_current_cell(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_use_id = r1.json()["stages"][0]["cell_use_id"]
    cell_id = r1.json()["stages"][0]["cell_id"]

    resp = _change_cell(client, cell_use_id, {"mode": "existing", "cell_id": cell_id})
    assert resp.status_code == 200, resp.text
    assert resp.json()["stages"][0]["cell_id"] == cell_id
    assert client.get(f"/api/cells/{cell_id}").json()["uses_consumed"] == 1


def test_change_cell_404_unknown_cell_use(client):
    resp = _change_cell(client, 999999, {"mode": "new"})
    assert resp.status_code == 404


def test_change_cell_404_unknown_target_cell(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_use_id = r1.json()["stages"][0]["cell_use_id"]

    resp = _change_cell(client, cell_use_id, {"mode": "existing", "cell_id": 999999})
    assert resp.status_code == 404


def test_change_cell_rejects_a_retired_target_cell(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_use_id = r1.json()["stages"][0]["cell_use_id"]

    retired = _bootstrap(client, uses_consumed=0)
    retire_resp = client.post(f"/api/cells/{retired['id']}/retire")
    assert retire_resp.status_code == 200, retire_resp.text

    resp = _change_cell(client, cell_use_id, {"mode": "existing", "cell_id": retired["id"]})
    assert resp.status_code == 409, resp.text
    assert "not open" in resp.json()["detail"].lower()


def test_change_cell_rejects_an_exhausted_target_cell(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2\nA3,bc3\nA4,bc4"})
    mon, tue, wed, thu = _weekdays(4)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    full_cell_id = r1.json()["stages"][0]["cell_id"]
    _place(client, _sid(client, "A2"), tue, slot_index=0, cell_choice={"mode": "existing", "cell_id": full_cell_id}, start_hour=15)
    _place(client, _sid(client, "A3"), wed, slot_index=0, cell_choice={"mode": "existing", "cell_id": full_cell_id}, start_hour=15)
    # full_cell_id now has all 3 of its uses consumed

    r4 = _place(client, _sid(client, "A4"), thu, slot_index=0, start_hour=15)
    cell_use_id_4 = r4.json()["stages"][0]["cell_use_id"]

    resp = _change_cell(client, cell_use_id_4, {"mode": "existing", "cell_id": full_cell_id})
    assert resp.status_code == 409, resp.text
    # recompute_status already flipped the cell's own status off "open" once its 3rd real
    # use landed, so that check fires first with a more specific message than a generic
    # "no remaining uses" would - both checks exist and either is a valid guard here.
    assert "not open" in resp.json()["detail"].lower()
    assert "exhausted" in resp.json()["detail"].lower()


def test_change_cell_rejects_a_barcode_conflict(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_use_id = r1.json()["stages"][0]["cell_use_id"]

    conflicting = _bootstrap(client, uses_consumed=1, burned_barcodes=["bc1"])

    resp = _change_cell(client, cell_use_id, {"mode": "existing", "cell_id": conflicting["id"]})
    assert resp.status_code == 409, resp.text
    assert "barcode" in resp.json()["detail"].lower()


def test_change_cell_rejects_a_target_cell_pinned_to_a_different_instrument(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0, instrument="84047")
    cell_use_id = r1.json()["stages"][0]["cell_use_id"]

    elsewhere = _bootstrap(client, instrument_serial="84098", uses_consumed=1, burned_barcodes=["bcOther"])

    resp = _change_cell(client, cell_use_id, {"mode": "existing", "cell_id": elsewhere["id"]})
    assert resp.status_code == 409, resp.text
    assert "instrument" in resp.json()["detail"].lower()


def test_change_cell_rejected_when_run_is_locked(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_use_id = r1.json()["stages"][0]["cell_use_id"]
    cycle_id = r1.json()["cycle_id"]

    assert client.patch(f"/api/cycles/{cycle_id}", json={"status": "running"}).status_code == 200

    resp = _change_cell(client, cell_use_id, {"mode": "new"})
    assert resp.status_code == 409, resp.text
    assert "planned" in resp.json()["detail"].lower()


def test_change_cell_writes_an_audit_log_entry(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_use_id = r1.json()["stages"][0]["cell_use_id"]
    old_cell_id = r1.json()["stages"][0]["cell_id"]

    resp = _change_cell(client, cell_use_id, {"mode": "new"})
    assert resp.status_code == 200, resp.text
    new_cell_id = resp.json()["stages"][0]["cell_id"]

    log = client.get("/api/audit-log", params={"entity_type": "cell_use", "entity_id": cell_use_id}).json()
    entries = [e for e in log["items"] if e["action"] == "change_cell"]
    assert len(entries) == 1
    details = entries[0]["details_json"]
    assert details["old_cell_id"] == old_cell_id
    assert details["new_cell_id"] == new_cell_id
