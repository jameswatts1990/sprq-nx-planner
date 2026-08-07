"""Duplicate Container ID samples (the "same sample run across multiple cells" feature,
frontend/src/pages/SampleModal.tsx) share a barcode by default - so the burned-barcode
carryover guard used to bar every copy from ever reusing a cell any sibling copy had
touched, even while a tray it could safely reuse still had capacity. A cell can only ever
be reused by a DIFFERENT copy of the exact same Container ID, never a genuinely different
sample sharing that barcode (see cell_service.foreign_barcode_clash and
docs/pacbio-sprq-nx-scheduling-reference.md's barcode-carryover exception, 2026-07-29).

Also covers the "Recalculate" action (POST /api/auto-fill/recalculate) that re-packs an
instrument's planned schedule from scratch under this rule - the fix for a schedule built
before the exemption existed."""
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


def _sids(client, external_id: str) -> list[int]:
    """Every sample id carrying this Container ID, oldest first - there are several once
    it's a duplicate, unlike _sid()'s single-match lookup elsewhere in this test suite."""
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return sorted(s["id"] for s in items if s["external_id"] == external_id)


def _stages(run):
    return [s for p in run["plates"] for s in p["stages"]]


def _stage_for(run, sample_id):
    """The one stage belonging to `sample_id` in `run` - unlike `_stages(run)[0]`, safe to use
    even when the run's response bundles more than one plate (e.g. two same-day placements
    share one run, so the naive first-stage would silently pick up the OTHER sample's own)."""
    return next(s for s in _stages(run) if s["sample_id"] == sample_id)


def _place(client, sample_id, run_date, slot_index, cell_choice, instrument="84047"):
    return client.post("/api/cell-uses", json={
        "sample_id": sample_id, "instrument_serial": instrument, "load_date": run_date,
        "slot_index": slot_index, "cell_choice": cell_choice, "run_time_hours": 24,
    })


def _auto(client, sample_id, run_date, slot_index, instrument="84047"):
    return client.post("/api/cell-uses", json={
        "sample_id": sample_id, "instrument_serial": instrument, "load_date": run_date,
        "slot_index": slot_index, "run_time_hours": 24,
    })


def test_duplicate_copy_reuses_a_cell_its_own_earlier_copy_already_used(client):
    """Two copies of Container ID DUP, same barcode. The second copy is dropped onto a
    Plate-2 slot of the same run as the first - the intra-run reuse branch of
    derive_best_cell - and must land on the exact same physical cell as its own earlier
    copy (Use 2), not be forced onto a fresh tray. duplicate_cell_reuse marks the result."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nDUP,bc1\nDUP,bc1"})
    (mon,) = _weekdays(1)
    dup1, dup2 = _sids(client, "DUP")

    r1 = _place(client, dup1, mon, 0, {"mode": "new"})
    assert r1.status_code == 201, r1.text
    cell_id = _stages(r1.json())[0]["cell_id"]

    r2 = _auto(client, dup2, mon, 4)  # Plate-2 slot of the same run -> intra-run reuse
    assert r2.status_code == 201, r2.text
    stage2 = next(s for s in _stages(r2.json()) if s["sample_id"] == dup2)
    assert stage2["cell_id"] == cell_id
    assert stage2["use_number"] == 2
    assert stage2["duplicate_cell_reuse"] is True
    assert stage2["barcode_clash"] is False  # allowed reuse, not the QC-danger "clash" flag


def test_a_different_sample_sharing_a_barcode_is_flagged_not_blocked_on_a_duplicates_cell(client):
    """The duplicate-Container-ID exemption only decides whether a self-reuse is FLAGGED; a
    genuinely different sample sharing DUP's barcode is still a real cross-sample clash. But as
    of 2026-08-07 a clash is warned, never blocked, on every manual path - so OTHER lands on
    DUP's cell as its 2nd use and is flagged (barcode_clash), not refused with a 409."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nDUP,bc1\nOTHER,bc1"})
    mon, tue = _weekdays(2)
    (dup1,) = _sids(client, "DUP")
    (other,) = _sids(client, "OTHER")

    r1 = _place(client, dup1, mon, 0, {"mode": "new"})
    cell_id = _stages(r1.json())[0]["cell_id"]

    r2 = _place(client, other, tue, 0, {"mode": "existing", "cell_id": cell_id})
    assert r2.status_code == 201, r2.text
    stage = next(s for s in _stages(r2.json()) if s["sample_external_id"] == "OTHER")
    assert stage["cell_id"] == cell_id
    assert stage["barcode_clash"] is True  # genuinely different sample -> real clash, flagged
    assert stage["duplicate_cell_reuse"] is False


def test_recalculate_consolidates_duplicate_copies_forced_onto_separate_trays(client):
    """Reproduces the reported bug's shape: two copies of one Container ID ended up on two
    separate fresh trays - here, an explicit {"mode":"new"} forcing the second copy onto its
    own tray in a different carousel position/day even though it could have reused the
    first's cell (e.g. built before this exemption existed, or a deliberate manual override).
    Recalculate re-packs the instrument's planned schedule from scratch and consolidates them
    onto one physical cell, reused across the two days."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nDUP,bc1\nDUP,bc1"})
    mon, tue = _weekdays(2)
    dup_ids = _sids(client, "DUP")

    r1 = _place(client, dup_ids[0], mon, 0, {"mode": "new"})  # Plate 1 box, Monday
    assert r1.status_code == 201, r1.text
    cell1 = _stages(r1.json())[0]["cell_id"]

    r2 = _place(client, dup_ids[1], tue, 4, {"mode": "new"})  # Plate 2 box, Tuesday - no collision
    assert r2.status_code == 201, r2.text
    cell2 = _stages(r2.json())[0]["cell_id"]
    assert cell2 != cell1  # forced onto two separate physical trays

    rec = client.post("/api/auto-fill/recalculate", json={"instrument_serial": "84047"})
    assert rec.status_code == 200, rec.text
    body = rec.json()
    assert set(body["placed_sample_ids"]) == set(dup_ids)
    assert body["unplaced_sample_ids"] == []

    all_stages = [s for run in body["runs"] for p in run["plates"] for s in p["stages"]]
    dup_stages = [s for s in all_stages if s["sample_id"] in dup_ids]
    assert len({s["cell_id"] for s in dup_stages}) == 1  # now sharing one physical cell
    reused = next(s for s in dup_stages if s["use_number"] == 2)
    assert reused["duplicate_cell_reuse"] is True


def test_recalculate_extends_into_a_new_day_when_the_existing_footprint_is_too_narrow_to_consolidate(client):
    """Reproduces the reported bug's shape (2026-07-29): two copies of one Container ID both
    forced onto the SAME single day (two separate fresh trays in the two different carousel
    boxes, since a cell can't be reused twice in one day) - recalculate's day-scope used to
    only ever offer back that one pre-existing day, so available_days=1 capped every fresh
    cell to Use 1 and it could never consolidate them no matter how "fewest" was set. It must
    now extend forward into a new day so one physical cell can be reused across the two,
    exactly like the already-two-day case above - and report the moved copy's day change."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nDUP,bc1\nDUP,bc1"})
    (mon,) = _weekdays(1)
    dup_ids = _sids(client, "DUP")

    r1 = _place(client, dup_ids[0], mon, 0, {"mode": "new"})  # Plate 1 box, Monday
    assert r1.status_code == 201, r1.text
    cell1 = _stage_for(r1.json(), dup_ids[0])["cell_id"]

    r2 = _place(client, dup_ids[1], mon, 4, {"mode": "new"})  # Plate 2 box, SAME day - no collision
    assert r2.status_code == 201, r2.text
    cell2 = _stage_for(r2.json(), dup_ids[1])["cell_id"]
    assert cell2 != cell1  # forced onto two separate physical trays on the one day available

    rec = client.post("/api/auto-fill/recalculate", json={"instrument_serial": "84047"})
    assert rec.status_code == 200, rec.text
    body = rec.json()
    assert set(body["placed_sample_ids"]) == set(dup_ids)
    assert body["unplaced_sample_ids"] == []

    all_stages = [s for run in body["runs"] for p in run["plates"] for s in p["stages"]]
    dup_stages = [s for s in all_stages if s["sample_id"] in dup_ids]
    assert len({s["cell_id"] for s in dup_stages}) == 1  # now sharing one physical cell, across two days
    reused = next(s for s in dup_stages if s["use_number"] == 2)
    assert reused["duplicate_cell_reuse"] is True

    # The first copy keeps its original Monday day; only the second had to move to a new day
    # (Tuesday) to make the consolidation possible - flagged distinctly from a mere cell/tray
    # reassignment since a day change has real lab-operational impact.
    assert body["day_changed_sample_ids"] == [dup_ids[1]]


def test_recalculate_is_a_no_op_when_nothing_is_planned(client):
    rec = client.post("/api/auto-fill/recalculate", json={"instrument_serial": "84047"})
    assert rec.status_code == 200, rec.text
    body = rec.json()
    assert body["placed_sample_ids"] == []
    assert body["unplaced_sample_ids"] == []
    assert body["runs"] == []


def test_recalculate_rejects_an_unknown_instrument(client):
    rec = client.post("/api/auto-fill/recalculate", json={"instrument_serial": "not-a-real-serial"})
    assert rec.status_code == 400, rec.text


def test_recalculate_never_touches_a_loaded_run(client):
    """A confirmed/loaded run's cells are physically already on the instrument in reality -
    recalculate must leave it exactly as-is, only touching still-`planned` runs."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    mon, tue = _weekdays(2)
    (a1,) = [s for s in _sids(client, "A1")]
    (a2,) = [s for s in _sids(client, "A2")]

    r1 = _place(client, a1, mon, 0, {"mode": "new"})  # Plate 1 box, Monday
    cycle_id = r1.json()["plates"][0]["plate_id"]
    locked = client.patch(f"/api/cycles/{cycle_id}", json={"status": "running"})
    assert locked.status_code == 200, locked.text
    locked_cell_id = _stages(locked.json())[0]["cell_id"]

    r2 = _place(client, a2, tue, 4, {"mode": "new"})  # Plate 2 box, Tuesday - no collision
    assert r2.status_code == 201, r2.text

    rec = client.post("/api/auto-fill/recalculate", json={"instrument_serial": "84047"})
    assert rec.status_code == 200, rec.text
    body = rec.json()
    # Only A2's still-planned placement was re-packed; A1's confirmed run is untouched.
    assert body["placed_sample_ids"] == [a2]

    still_locked = client.get(f"/api/cycles/{cycle_id}").json()
    assert still_locked["status"] == "running"
    assert _stages(still_locked)[0]["cell_id"] == locked_cell_id
