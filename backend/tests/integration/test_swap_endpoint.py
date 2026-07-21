"""POST /api/cell-uses/{id}/swap: exchange which sample sits on two already-placed
cell uses, for the weekly grid's "drag a placed sample onto a different occupied slot"
interaction. Deliberately never touches cycle_id/well/cell_id on either side - only
sample_id and its barcode snapshot move - so a swap can never violate the 3-use cap, the
108h window, or the (cycle_id, well) unique constraint; the only real thing left to guard
is a cross-cell barcode clash."""
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


def _swap(client, cell_use_id, other_cell_use_id):
    return client.post(f"/api/cell-uses/{cell_use_id}/swap", json={"other_cell_use_id": other_cell_use_id})


def test_swap_cross_cell_cross_day_cross_instrument_exchanges_samples_only(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    mon, tue = _weekdays(2)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0, instrument="84047")
    r2 = _place(client, _sid(client, "A2"), tue, slot_index=1, instrument="84098")
    use_a = r1.json()["stages"][0]
    use_b = r2.json()["stages"][0]

    resp = _swap(client, use_a["cell_use_id"], use_b["cell_use_id"])
    assert resp.status_code == 200, resp.text
    cycles = resp.json()
    assert len(cycles) == 2

    stage_a = next(s for cyc in cycles for s in cyc["stages"] if s["cell_use_id"] == use_a["cell_use_id"])
    stage_b = next(s for cyc in cycles for s in cyc["stages"] if s["cell_use_id"] == use_b["cell_use_id"])

    # samples exchanged...
    assert stage_a["sample_external_id"] == "A2"
    assert stage_a["barcodes"] == ["bc2"]
    assert stage_b["sample_external_id"] == "A1"
    assert stage_b["barcodes"] == ["bc1"]
    # ...but neither placement's day/well/cell moved.
    assert stage_a["cell_id"] == use_a["cell_id"]
    assert stage_a["well"] == use_a["well"]
    assert stage_b["cell_id"] == use_b["cell_id"]
    assert stage_b["well"] == use_b["well"]
    assert stage_a["use_number"] == use_a["use_number"]
    assert stage_b["use_number"] == use_b["use_number"]


def test_swap_within_the_same_physical_cell(client):
    """A cell's own Use 1 <-> Use 2: no barcode-clash check ever applies (they already
    share one burned-barcode set), so this must succeed unconditionally."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    mon, tue = _weekdays(2)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_id = r1.json()["stages"][0]["cell_id"]
    use_1 = r1.json()["stages"][0]
    r2 = _place(client, _sid(client, "A2"), tue, slot_index=0, cell_choice={"mode": "existing", "cell_id": cell_id}, start_hour=15)
    use_2 = r2.json()["stages"][0]

    resp = _swap(client, use_1["cell_use_id"], use_2["cell_use_id"])
    assert resp.status_code == 200, resp.text
    cycle = resp.json()[0]
    stage_1 = next(s for s in cycle["stages"] if s["cell_use_id"] == use_1["cell_use_id"])
    assert stage_1["sample_external_id"] == "A2"
    stage_2 = next(s for cyc in resp.json() for s in cyc["stages"] if s["cell_use_id"] == use_2["cell_use_id"])
    assert stage_2["sample_external_id"] == "A1"

    assert client.get(f"/api/cells/{cell_id}").json()["uses_consumed"] == 2


def test_swap_rejects_cross_cell_barcode_clash(client):
    """cellA holds two real uses (A1/bc1, A4/bc4); cellB holds one (A5/bc4, same barcode
    text as A4 - allowed, barcode uniqueness is per-sample, not global). Swapping A1's use
    onto cellB is fine, but swapping A5's use onto cellA must be rejected: cellA already
    has bc4 burned by A4's *other*, non-vacating use."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA4,bc4\nA5,bc4"})
    mon, tue = _weekdays(2)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0, instrument="84047")
    cell_a = r1.json()["stages"][0]["cell_id"]
    r4 = _place(
        client, _sid(client, "A4"), tue, slot_index=0, instrument="84047",
        cell_choice={"mode": "existing", "cell_id": cell_a}, start_hour=15,
    )
    assert r4.status_code == 201, r4.text

    r5 = _place(client, _sid(client, "A5"), mon, slot_index=1, instrument="84098")
    use_1 = r1.json()["stages"][0]
    use_5 = r5.json()["stages"][0]

    resp = _swap(client, use_1["cell_use_id"], use_5["cell_use_id"])
    assert resp.status_code == 409, resp.text
    assert "barcode" in resp.json()["detail"].lower()

    # nothing changed
    assert client.get(f"/api/cell-uses/{use_1['cell_use_id']}").json()["sample_external_id"] == "A1"
    assert client.get(f"/api/cell-uses/{use_5['cell_use_id']}").json()["sample_external_id"] == "A5"


def test_swap_rejects_when_owning_cycle_is_locked(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    mon, tue = _weekdays(2)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    # slot_index 4 (well A02, tray box 2) opens a genuinely separate tray from A1's box.
    r2 = _place(client, _sid(client, "A2"), tue, slot_index=4)
    use_1 = r1.json()["stages"][0]
    use_2 = r2.json()["stages"][0]

    locked = client.patch(f"/api/cycles/{r1.json()['cycle_id']}", json={"status": "running"})
    assert locked.status_code == 200, locked.text

    resp = _swap(client, use_1["cell_use_id"], use_2["cell_use_id"])
    assert resp.status_code == 409, resp.text
    assert "planned" in resp.json()["detail"].lower()


def test_swap_rejects_a_cancelled_placement(client):
    """Stopping a cell permanently cancels its future use as a "this never happened"
    marker - not a re-plannable placement, so it can never be a swap side."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    mon, tue = _weekdays(2)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_id = r1.json()["stages"][0]["cell_id"]
    # slot_index 4 (well A02, tray box 2) opens a genuinely separate tray from A1's box.
    r2 = _place(client, _sid(client, "A2"), tue, slot_index=4)
    use_2 = r2.json()["stages"][0]

    stopped = client.post(f"/api/cells/{cell_id}/stop", json={"reason": "QC issue"})
    assert stopped.status_code == 200, stopped.text
    cu = client.get(f"/api/cell-uses/{r1.json()['stages'][0]['cell_use_id']}").json()
    assert cu["status"] == "cancelled"

    resp = _swap(client, cu["id"], use_2["cell_use_id"])
    assert resp.status_code == 409, resp.text


def test_swap_self_swap_rejected(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    use_1 = r1.json()["stages"][0]

    resp = _swap(client, use_1["cell_use_id"], use_1["cell_use_id"])
    assert resp.status_code == 400, resp.text


def test_swap_not_found(client):
    resp = _swap(client, 999999, 999998)
    assert resp.status_code == 404, resp.text
