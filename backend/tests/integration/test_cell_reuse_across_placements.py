"""The proof that the prototype's manual "in-progress cells" hack is truly gone:
a cell with remaining capacity and burned barcodes from an EARLIER placement can be
explicitly chosen for a LATER placement on a different day, and a new sample sharing a
burned barcode is correctly barred from it (409).
"""
from datetime import date, timedelta

import pytest


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


def _stages(run):
    """All stages across a run's plates, flattened (plate 1 then plate 2). A single
    placement into slot 0-3 yields one plate; a fresh parallel/second-tray or reuse
    placement adds a second plate."""
    return [s for p in run["plates"] for s in p["stages"]]


def _sid(client, pool_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["pool_id"] == pool_id)


def _place(client, sample_id, run_date, slot_index, cell_choice, run_time_hours=24, instrument="84047", start_hour=None):
    payload = {
        "sample_id": sample_id,
        "instrument_serial": instrument,
        "load_date": run_date,
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
    cell_id = _stages(cycle1)[0]["cell_id"]
    assert _stages(cycle1)[0]["sample_pool_id"] == "S1"

    cell = client.get(f"/api/cells/{cell_id}").json()
    assert cell["uses_consumed"] == 1
    assert cell["burned_barcodes"] == ["bc1"]

    # --- S2 (no clash) explicitly reuses that SAME cell on Tuesday - zero manual re-entry ---
    # start_hour is set explicitly (rather than relying on the default) simply to pin this
    # test's own timing regardless of what the default loading start time happens to be.
    r2 = _place(client, _sid(client, "S2"), tue, 0, {"mode": "existing", "cell_id": cell_id}, start_hour=15)
    assert r2.status_code == 201, r2.text
    assert _stages(r2.json())[0]["cell_id"] == cell_id

    cell = client.get(f"/api/cells/{cell_id}").json()
    assert cell["uses_consumed"] == 2
    assert cell["uses_remaining"] == 1
    assert cell["burned_barcodes"] == ["bc1", "bc2"]

    # --- S3 (shares burned bc1) is NO LONGER barred - warn, don't block (2026-08-07). It lands
    # as the cell's 3rd use, flagged as a barcode clash, and exhausts the cell. ---
    r3 = _place(client, _sid(client, "S3"), wed, 0, {"mode": "existing", "cell_id": cell_id}, start_hour=15)
    assert r3.status_code == 201, r3.text
    s3_stage = next(s for s in _stages(r3.json()) if s["sample_pool_id"] == "S3")
    assert s3_stage["cell_id"] == cell_id
    assert s3_stage["barcode_clash"] is True

    cell = client.get(f"/api/cells/{cell_id}").json()
    assert cell["uses_consumed"] == 3
    assert cell["uses_remaining"] == 0
    assert cell["status"] == "exhausted"

    # --- S4 genuinely can't reuse it now: no remaining capacity. Capacity (the 3-use cap) is a
    # REAL block, unchanged by the warn-don't-block clash rule - the two are distinct. ---
    (thu,) = _weekdays(4)[3:4]
    r4 = _place(client, _sid(client, "S4"), thu, 0, {"mode": "existing", "cell_id": cell_id}, start_hour=21)
    assert r4.status_code == 409, r4.text
    assert "exhausted" in r4.json()["detail"].lower()  # capacity is a real block, not a clash

    # S3 shared bc1 (already burned), so the union is unchanged; S4 never landed.
    assert client.get(f"/api/cells/{cell_id}").json()["burned_barcodes"] == ["bc1", "bc2"]


def test_reusing_a_cell_on_a_different_instrument_than_its_current_one_is_rejected(client):
    # Cells cannot move between instruments: once a cell has a real use on 84047, it
    # can never be explicitly reused on a different instrument, even with capacity to spare.
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nT1,bc1\nT2,bc2"})
    (mon,) = _weekdays(1)

    r1 = _place(client, _sid(client, "T1"), mon, 0, {"mode": "new"}, instrument="84047")
    assert r1.status_code == 201, r1.text
    cell_id = _stages(r1.json())[0]["cell_id"]

    r2 = _place(client, _sid(client, "T2"), mon, 0, {"mode": "existing", "cell_id": cell_id}, instrument="84098")
    assert r2.status_code == 409, r2.text
    assert "instrument" in r2.json()["detail"].lower()


def test_reuse_before_cell_is_physically_ready_is_flagged_but_not_blocked(client):
    """Advisory only (docs/pacbio-sprq-nx-scheduling-reference.md's "Deliberate
    simplifications"): explicitly reusing a cell sooner than its prior use's real movie end (when
    the cell is physically free) still succeeds - it's flagged on the returned stage, never rejected."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nR1,bc10\nR2,bc11"})
    mon, tue, _wed = _weekdays(3)

    r1 = _place(client, _sid(client, "R1"), mon, 0, {"mode": "new"}, run_time_hours=24, start_hour=12)
    assert r1.status_code == 201, r1.text
    cell_id = _stages(r1.json())[0]["cell_id"]

    # Monday noon + 4h prep + 24h movie -> real movie end (cell physically free) at Tuesday 16:00.
    # An 08:00 Tuesday reuse lands well before that.
    r2 = _place(client, _sid(client, "R2"), tue, 0, {"mode": "existing", "cell_id": cell_id}, start_hour=8)
    assert r2.status_code == 201, r2.text  # advisory only - never blocked
    stage = next(s for s in _stages(r2.json()) if s["cell_id"] == cell_id and s["sample_pool_id"] == "R2")
    assert stage["reuse_not_ready_hours"] == pytest.approx(8.0, abs=0.05)


def test_reuse_safely_after_cell_is_ready_has_no_flag(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nR3,bc12\nR4,bc13"})
    mon, tue, _wed = _weekdays(3)

    r1 = _place(client, _sid(client, "R3"), mon, 0, {"mode": "new"}, run_time_hours=24, start_hour=12)
    assert r1.status_code == 201, r1.text
    cell_id = _stages(r1.json())[0]["cell_id"]

    # Real movie end (cell free) at Tuesday 16:00 (see above) - a 20:00 Tuesday reuse lands safely after.
    r2 = _place(client, _sid(client, "R4"), tue, 0, {"mode": "existing", "cell_id": cell_id}, start_hour=20)
    assert r2.status_code == 201, r2.text
    stage = next(s for s in _stages(r2.json()) if s["cell_id"] == cell_id and s["sample_pool_id"] == "R4")
    assert stage["reuse_not_ready_hours"] is None


def test_reuse_dropped_on_a_later_day_stays_on_that_day(client):
    """The drop is sacrosanct: dropping a reuse onto a later day column places it on THAT day,
    acquiring THAT day - the app never relocates a card the user dropped to an earlier day, even
    though the cell's prep-aware free time is later. (The prep-aware reuse chaining governs only an
    intra-run Plate 2's *derived* acquire day, never a card dropped directly onto a day column.)"""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nD1,bcd1\nD2,bcd2"})
    mon, _tue, wed = _weekdays(3)

    r1 = _place(client, _sid(client, "D1"), mon, 0, {"mode": "new"}, run_time_hours=24, start_hour=12)
    assert r1.status_code == 201, r1.text
    cell_id = _stages(r1.json())[0]["cell_id"]

    # Drop the reuse onto WEDNESDAY - it must land on Wednesday, acquiring Wednesday.
    r2 = _place(client, _sid(client, "D2"), wed, 0, {"mode": "existing", "cell_id": cell_id})
    assert r2.status_code == 201, r2.text
    run = r2.json()
    assert run["load_date"] == wed
    plate = next(p for p in run["plates"] if any(s["sample_pool_id"] == "D2" for s in p["stages"]))
    assert plate["acquire_date"] == wed
