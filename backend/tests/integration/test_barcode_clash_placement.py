"""A tray breaks its cells out in a fixed physical order (▣1 before ▣2 before ▣3 before ▣4), so
across a plate's loading slots the cells drawn from one physical tray must appear in that same
order - a sample dropped onto a well must land on whichever cell the instrument would actually
reach for next, never a different one chosen to dodge a barcode clash (reported by the lab
owner, 2026-08-05: a manual drop skipped the naturally-next, in-order cell for a later-position
sibling because of a barcode clash, an impossible cell order a real instrument would never
produce). `derive_best_cell` no longer excludes a candidate cell for a barcode clash - see
_reuse_eligible - so the natural, in-order cell always wins and a resulting clash surfaces as
StageOut.barcode_clash (see cell_service.has_barcode_clash) instead of forcing a reroute or
blocking the drop outright. The one place a clash still hard-blocks the request is an *explicit*
"use this exact cell" choice (_resolve_cell_choice) - a free pick with other cells available, so
there's no ordering constraint forcing the clash there.
"""
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


def _stages(run):
    return [s for p in run["plates"] for s in p["stages"]]


def _auto(client, sample_id, run_date, slot_index, instrument="84047", run_time_hours=24):
    return client.post("/api/cell-uses", json={
        "sample_id": sample_id, "instrument_serial": instrument, "load_date": run_date,
        "slot_index": slot_index, "run_time_hours": run_time_hours,
    })


def _place(client, sample_id, run_date, slot_index, cell_choice, instrument="84047"):
    return client.post("/api/cell-uses", json={
        "sample_id": sample_id, "instrument_serial": instrument, "load_date": run_date,
        "slot_index": slot_index, "cell_choice": cell_choice, "run_time_hours": 24,
    })


def test_clash_no_longer_forces_a_skip_and_is_flagged_instead(client):
    """Monday burns bc1 onto cell ▣1 and bc2 onto ▣2. On Tuesday, TRAC (bc1, clashes ▣1) is
    dropped onto A01: the natural next-in-order cell is still ▣1 (most-used, lowest tray
    position) - TRAC lands there anyway, flagged as a barcode clash, rather than being silently
    rerouted to ▣2. Dropping the non-clashing T7 onto B01 afterward then takes ▣2 - a plain,
    ascending ▣1-then-▣2 tray order across the plate's slots, exactly what a real instrument
    would produce, with no error at any point."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nT1,bc1\nT2,bc2\nTRAC,bc1\nT7,bc7"})
    mon, tue = _weekdays(2)

    _place(client, _sid(client, "T1"), mon, 0, {"mode": "new"})  # cell ▣1 (A01) burns bc1
    _auto(client, _sid(client, "T2"), mon, 1)                    # cell ▣2 (B01) burns bc2

    trac = _auto(client, _sid(client, "TRAC"), tue, 0)
    assert trac.status_code == 201, trac.text
    trac_stage = next(s for s in _stages(trac.json()) if s["sample_external_id"] == "TRAC")
    assert trac_stage["tray_position"] == 1  # natural in-order cell, not skipped for the clash
    assert trac_stage["barcode_clash"] is True

    r7 = _auto(client, _sid(client, "T7"), tue, 1)
    assert r7.status_code == 201, r7.text
    t7_stage = next(s for s in _stages(r7.json()) if s["sample_external_id"] == "T7")
    assert t7_stage["tray_position"] == 2
    assert t7_stage["barcode_clash"] is False

    # Nothing bounced to the backlog - both drops committed.
    assert client.get(f"/api/samples/{_sid(client, 'TRAC')}").json()["status"] == "scheduled"
    assert client.get(f"/api/samples/{_sid(client, 'T7')}").json()["status"] == "scheduled"


def test_explicit_cell_choice_still_rejects_a_barcode_clash(client):
    """The one place a clash still hard-blocks: naming a specific cell via an explicit
    cell_choice (the CellInfoPopover "choose a specific cell" override). Unlike a plain drag
    onto a fixed well, the caller here has other cells freely available, so there's no ordering
    constraint forcing the clash - it's refused outright instead of being flagged."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nT1,bc1\nTRAC,bc1"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "T1"), mon, 0, {"mode": "new"})
    cell_x = _stages(r1.json())[0]["cell_id"]

    r2 = _place(client, _sid(client, "TRAC"), mon, 1, {"mode": "existing", "cell_id": cell_x})
    assert r2.status_code == 409, r2.text
    assert "barcode conflict" in r2.json()["detail"]
    assert client.get(f"/api/samples/{_sid(client, 'TRAC')}").json()["status"] == "backlog"


def test_reuse_depth_difference_allows_a_later_cell_in_an_earlier_slot(client):
    """Two cells differing in reuse depth (one nearer its 108h expiry - "most-used first") can
    legitimately put a later-position cell in an earlier slot - unrelated to barcode clashes,
    unaffected by the clash fix above. Build a Wednesday plate whose A01 is backed by the
    more-used ▣2 (Use 3) and whose B01 is backed by the less-used ▣1 (Use 2)."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA,ba\nB,bb\nC,bc\nD,bd\nE,be"})
    mon, tue, wed = _weekdays(3)

    r1 = _place(client, _sid(client, "A"), mon, 0, {"mode": "new"})  # opens tray on ▣1 (A01)
    cell1 = _stages(r1.json())[0]["cell_id"]
    tray_id = client.get(f"/api/cells/{cell1}").json()["tray_id"]
    cell2 = next(
        c["id"] for c in client.get("/api/cells", params={"tray_id": tray_id}).json()["items"]
        if c["current_well"] == "B01"
    )

    _place(client, _sid(client, "B"), mon, 1, {"mode": "existing", "cell_id": cell2})  # ▣2 Use 1
    _place(client, _sid(client, "C"), tue, 1, {"mode": "existing", "cell_id": cell2})  # ▣2 Use 2

    # Wednesday: ▣2 -> Use 3 in A01 (more-used), ▣1 -> Use 2 in B01 (less-used).
    r_d = _place(client, _sid(client, "D"), wed, 0, {"mode": "existing", "cell_id": cell2})
    assert r_d.status_code == 201, r_d.text
    r_e = _place(client, _sid(client, "E"), wed, 1, {"mode": "existing", "cell_id": cell1})
    assert r_e.status_code == 201, r_e.text  # ▣2-before-▣1 across slots, but depths differ -> allowed
    stages = {s["sample_external_id"]: s for s in _stages(r_e.json())}
    assert stages["D"]["tray_position"] == 2 and stages["E"]["tray_position"] == 1


def test_non_clashing_reorder_within_a_plate_is_unaffected(client):
    """A plain two-sample plate with no barcode clash and cells in tray order commits normally."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nP,bp\nQ,bq"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "P"), mon, 0, {"mode": "new"})
    assert r1.status_code == 201
    r2 = _auto(client, _sid(client, "Q"), mon, 1)
    assert r2.status_code == 201, r2.text
    stages = {s["sample_external_id"]: s for s in _stages(r2.json())}
    assert stages["P"]["tray_position"] == 1 and stages["Q"]["tray_position"] == 2
