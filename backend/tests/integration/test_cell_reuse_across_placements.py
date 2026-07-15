"""The proof that the prototype's manual "in-progress cells" hack is truly gone:
a cell with remaining capacity and burned barcodes from an EARLIER placement can be
explicitly chosen for a LATER placement on a different day, and a new sample sharing a
burned barcode is correctly barred from it (409).
"""
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


def _place(client, sample_id, run_date, slot_index, cell_choice, run_time_hours=24, instrument="84047", start_hour=None):
    payload = {
        "sample_id": sample_id,
        "instrument_serial": instrument,
        "run_date": run_date,
        "slot_index": slot_index,
        "cell_choice": cell_choice,
        "run_time_hours": run_time_hours,
        "max_uses": 3,
    }
    if start_hour is not None:
        payload["start_hour"] = start_hour
    return client.post("/api/cell-uses", json=payload)


def test_cell_with_remaining_capacity_is_reused_across_days_and_burned_barcodes_respected(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nS1,bc1\nS2,bc2\nS3,bc1\nS4,bc3"})
    mon, tue, wed = _weekdays(3)

    # --- S1 onto a fresh cell (cap 3) on Monday ---
    r1 = _place(client, _sid(client, "S1"), mon, 0, {"mode": "new"})
    assert r1.status_code == 201, r1.text
    cycle1 = r1.json()
    cell_id = cycle1["stages"][0]["cell_id"]
    assert cycle1["stages"][0]["sample_external_id"] == "S1"

    cell = client.get(f"/api/cells/{cell_id}").json()
    assert cell["uses_consumed"] == 1
    assert cell["burned_barcodes"] == ["bc1"]

    # --- S2 (no clash) explicitly reuses that SAME cell on Tuesday - zero manual re-entry ---
    # start_hour is set explicitly (rather than relying on the default) simply to pin this
    # test's own timing regardless of what the default loading start time happens to be.
    r2 = _place(client, _sid(client, "S2"), tue, 0, {"mode": "existing", "cell_id": cell_id}, start_hour=15)
    assert r2.status_code == 201, r2.text
    assert r2.json()["stages"][0]["cell_id"] == cell_id

    cell = client.get(f"/api/cells/{cell_id}").json()
    assert cell["uses_consumed"] == 2
    assert cell["uses_remaining"] == 1
    assert cell["burned_barcodes"] == ["bc1", "bc2"]

    # --- S3 (shares burned bc1) is barred from that cell (409) ---
    r3 = _place(client, _sid(client, "S3"), wed, 0, {"mode": "existing", "cell_id": cell_id})
    assert r3.status_code == 409, r3.text
    assert "barcode" in r3.json()["detail"].lower()

    # --- S4 (bc3, no clash) takes the last slot, exhausting the cell ---
    # r3 above never reached the lock check (it 409s on the barcode conflict first), so r4
    # is the first write into Wednesday's grid cell - start_hour is pinned explicitly here
    # too, for the same reason as r2 above.
    r4 = _place(client, _sid(client, "S4"), wed, 0, {"mode": "existing", "cell_id": cell_id}, start_hour=21)
    assert r4.status_code == 201, r4.text

    cell = client.get(f"/api/cells/{cell_id}").json()
    assert cell["uses_consumed"] == 3
    assert cell["uses_remaining"] == 0
    assert cell["status"] == "exhausted"
    assert cell["burned_barcodes"] == ["bc1", "bc2", "bc3"]


def test_reusing_a_cell_on_a_different_instrument_than_its_current_one_is_rejected(client):
    # Cells cannot move between instruments: once a cell has a real use on 84047, it
    # can never be explicitly reused on a different instrument, even with capacity to spare.
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nT1,bc1\nT2,bc2"})
    (mon,) = _weekdays(1)

    r1 = _place(client, _sid(client, "T1"), mon, 0, {"mode": "new"}, instrument="84047")
    assert r1.status_code == 201, r1.text
    cell_id = r1.json()["stages"][0]["cell_id"]

    r2 = _place(client, _sid(client, "T2"), mon, 0, {"mode": "existing", "cell_id": cell_id}, instrument="84098")
    assert r2.status_code == 409, r2.text
    assert "instrument" in r2.json()["detail"].lower()
