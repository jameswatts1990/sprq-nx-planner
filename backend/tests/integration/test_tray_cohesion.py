"""A Plate (Cycle) must never hold cells from more than one physical tray - a plate is
physically one carousel box, which can only ever hold one tray at a time. Reproduces the
reported bug: a Plate 2 box showing mismatched use-numbers across its 4 wells because one
well silently fell through to an unrelated tray once its own sibling became ineligible."""
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


def _sid(client, pool_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["pool_id"] == pool_id)


def _stage_for(run, pool_id: str):
    return next(s for s in _stages(run) if s["sample_pool_id"] == pool_id)


def _place(client, sample_id, run_date, slot_index, cell_choice=None, instrument="84047"):
    payload = {
        "sample_id": sample_id,
        "instrument_serial": instrument,
        "load_date": run_date,
        "slot_index": slot_index,
        "run_time_hours": 24,
        "max_uses": 3,
    }
    if cell_choice is not None:
        payload["cell_choice"] = cell_choice
    return client.post("/api/cell-uses", json=payload)


def _tray_id_of(client, cell_id: int) -> int:
    return client.get(f"/api/cells/{cell_id}").json()["tray_id"]


def test_plate2_reuse_well_that_cant_reuse_plate1_tray_is_flagged_not_a_foreign_tray(client):
    """The exact reported bug: Plate 1 fully packed onto one tray (4 samples, uniform
    tray_id). Plate 2 correctly reuses 3 of that tray's cells, and the 4th sample barcode-
    clashes with the last remaining sibling - tray cohesion still holds (it must never be
    silently handed an unrelated tray's cell, which is what used to produce mismatched
    use-numbers), but the clash itself is now allowed and flagged rather than rejected: this
    plate has exactly one tray, so the last remaining well's sample has nowhere else to go
    without breaking tray order (see docs/pacbio-sprq-nx-scheduling-reference.md's
    "sequential samples in a plate always take sequential cells" rule)."""
    client.post(
        "/api/imports",
        json={"raw_text": "sample,barcodes\nP1,bcp1\nP2,bcp2\nP3,bcp3\nP4,bcp4"},
    )
    (mon,) = _weekdays(1)

    r1 = _place(client, _sid(client, "P1"), mon, 0, {"mode": "new"})
    assert r1.status_code == 201, r1.text
    for ext, slot in (("P2", 1), ("P3", 2), ("P4", 3)):
        r = _place(client, _sid(client, ext), mon, slot)
        assert r.status_code == 201, r.text

    run = client.get(f"/api/cycles/{r1.json()['run_id']}").json()
    plate1_stages = [s for p in run["plates"] if p["plate_index"] == 1 for s in p["stages"]]
    assert len(plate1_stages) == 4
    tray_id = _tray_id_of(client, plate1_stages[0]["cell_id"])
    assert all(_tray_id_of(client, s["cell_id"]) == tray_id for s in plate1_stages)

    # Q4 shares a barcode with every one of Plate 1's samples, so whichever tray-sibling is
    # left over for it will always clash, regardless of pick order. Plate 2 reuse is placed
    # onto the SAME load_date as Plate 1 (same RunBatch, slot_index 4-7) - the acquire date
    # floats later automatically; only the load_date identifies which run it joins.
    client.post(
        "/api/imports",
        json={"raw_text": "sample,barcodes\nQ1,bcq1\nQ2,bcq2\nQ3,bcq3\nQ4,bcp1;bcp2;bcp3;bcp4"},
    )
    for ext, slot in (("Q1", 4), ("Q2", 5), ("Q3", 6)):
        r = _place(client, _sid(client, ext), mon, slot)
        assert r.status_code == 201, r.text

    run_id = r1.json()["run_id"]
    before = client.get(f"/api/cycles/{run_id}").json()
    plate2_before = [s for p in before["plates"] if p["plate_index"] == 2 for s in p["stages"]]
    assert len(plate2_before) == 3
    assert all(_tray_id_of(client, s["cell_id"]) == tray_id for s in plate2_before)

    r4 = _place(client, _sid(client, "Q4"), mon, 7)
    assert r4.status_code == 201, r4.text
    q4_stage = _stage_for(r4.json(), "Q4")
    assert q4_stage["barcode_clash"] is True

    after = client.get(f"/api/cycles/{run_id}").json()
    plate2_after = [s for p in after["plates"] if p["plate_index"] == 2 for s in p["stages"]]
    assert len(plate2_after) == 4, "Q4 joined Plate 2 on the same physical tray, not a foreign one"
    assert all(_tray_id_of(client, s["cell_id"]) == tray_id for s in plate2_after)


def test_explicit_existing_cell_pick_from_a_foreign_tray_is_rejected(client):
    """A fresh parallel Plate 2 (its own physical tray, same instrument+day, box 1) is a
    DIFFERENT tray from Plate 1's - an explicit pick must not be able to graft one plate's
    cell onto the other's already-committed plate."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nF1,bcf1\nF2,bcf2\nF3,bcf3"})
    (mon,) = _weekdays(1)

    r1 = _place(client, _sid(client, "F1"), mon, 0, {"mode": "new"})
    assert r1.status_code == 201, r1.text
    tray_a = _tray_id_of(client, _stage_for(r1.json(), "F1")["cell_id"])

    r2 = _place(client, _sid(client, "F2"), mon, 4, {"mode": "new"})  # fresh parallel Plate 2
    assert r2.status_code == 201, r2.text
    f2_cell_id = _stage_for(r2.json(), "F2")["cell_id"]
    tray_b = _tray_id_of(client, f2_cell_id)
    assert tray_b != tray_a

    # A SIBLING of tray B (not F2's own cell, which is already used in this run and would
    # just read as its own intra-run reuse) - genuinely foreign to Plate 1, never yet used
    # anywhere in this run.
    tray_b_cells = client.get("/api/cells", params={"instrument_serial": "84047", "tray_id": tray_b}).json()["items"]
    foreign_sibling_id = next(c["id"] for c in tray_b_cells if c["id"] != f2_cell_id)

    r3 = _place(client, _sid(client, "F3"), mon, 1, {"mode": "existing", "cell_id": foreign_sibling_id})
    assert r3.status_code == 409, r3.text
    assert f"T{tray_a}" in r3.json()["detail"]


def test_explicit_new_mode_into_a_plate_already_holding_an_intra_run_reuse_is_rejected(client):
    """Plate 2 can already hold cells from Plate 1's tray via intra-run reuse WITHOUT its own
    box ever having had a physical tray opened - so box-collision alone can't catch a
    mismatched `{"mode":"new"}` pick here; only the plate-level tray-cohesion check can."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nG1,bcg1\nG2,bcg2\nG3,bcg3"})
    (mon,) = _weekdays(1)

    r1 = _place(client, _sid(client, "G1"), mon, 0, {"mode": "new"})
    assert r1.status_code == 201, r1.text
    plate1_cell_id = _stages(r1.json())[0]["cell_id"]
    tray_a = _tray_id_of(client, plate1_cell_id)
    tray_a_cells = client.get("/api/cells", params={"instrument_serial": "84047", "tray_id": tray_a}).json()["items"]
    sibling_cell_id = next(c["id"] for c in tray_a_cells if c["id"] != plate1_cell_id)

    r2 = _place(client, _sid(client, "G2"), mon, 4, {"mode": "existing", "cell_id": sibling_cell_id})
    assert r2.status_code == 201, r2.text

    r3 = _place(client, _sid(client, "G3"), mon, 5, {"mode": "new"})
    assert r3.status_code == 409, r3.text
    assert f"T{tray_a}" in r3.json()["detail"]


def test_four_clean_placements_across_one_tray_still_succeed(client):
    """Regression guard: the new checks must not get in the way of the common, correct case."""
    client.post(
        "/api/imports",
        json={"raw_text": "sample,barcodes\nH1,bch1\nH2,bch2\nH3,bch3\nH4,bch4"},
    )
    (mon,) = _weekdays(1)

    r1 = _place(client, _sid(client, "H1"), mon, 0, {"mode": "new"})
    assert r1.status_code == 201, r1.text
    for ext, slot in (("H2", 1), ("H3", 2), ("H4", 3)):
        r = _place(client, _sid(client, ext), mon, slot)
        assert r.status_code == 201, r.text

    run = client.get(f"/api/cycles/{r1.json()['run_id']}").json()
    stages = _stages(run)
    assert len(stages) == 4
    tray_id = _tray_id_of(client, stages[0]["cell_id"])
    assert all(_tray_id_of(client, s["cell_id"]) == tray_id for s in stages)
