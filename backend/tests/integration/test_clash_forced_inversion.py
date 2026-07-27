"""A barcode clash must never silently produce an impossible plate cell order.

A tray breaks its cells out in physical order (▣1 before ▣2 before ▣3 before ▣4), so across a
plate's loading slots the cells drawn from one tray must appear in that same order. `derive_best_cell`
treats a slot as a pure loading position and reaches for the next-in-order *eligible* cell, so a
sample whose barcode clashes with the cell that would naturally back its slot is silently handed a
later-position sibling instead - which can transpose two equally-reusable cells and render a
physically impossible "▣2 before ▣1" order on the grid, with no error (reported by the lab owner,
2026-07-27). The placement path now refuses that transposition. A genuine reuse-depth difference
(most-used-first / a shorter run) legitimately reorders cells and is still allowed.
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


def test_clash_forced_tray_position_inversion_is_blocked(client):
    """Monday burns bc1 onto cell ▣1 and bc2 onto ▣2. On Tuesday, TRAC (bc1, clashes ▣1) is
    dropped onto A01 and silently reuses ▣2 (▣1 skipped for the clash). Dropping the non-clashing
    T7 onto B01 would then take ▣1 - loading ▣2 (A01) before ▣1 (B01), an impossible tray order.
    That second drop is refused with a message naming TRAC's clash, and nothing is placed."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nT1,bc1\nT2,bc2\nTRAC,bc1\nT7,bc7"})
    mon, tue = _weekdays(2)

    _place(client, _sid(client, "T1"), mon, 0, {"mode": "new"})  # cell ▣1 (A01) burns bc1
    _auto(client, _sid(client, "T2"), mon, 1)                    # cell ▣2 (B01) burns bc2

    trac = _auto(client, _sid(client, "TRAC"), tue, 0)           # clashes ▣1 -> silently lands ▣2
    assert trac.status_code == 201, trac.text
    assert next(s for s in _stages(trac.json()) if s["sample_external_id"] == "TRAC")["tray_position"] == 2

    r7 = _auto(client, _sid(client, "T7"), tue, 1)               # would complete the ▣2-before-▣1 inversion
    assert r7.status_code == 409, r7.text
    detail = r7.json()["detail"]
    assert "TRAC" in detail and "▣1" in detail and "▣2" in detail

    # Nothing was placed: T7 stays in the backlog (the drop rolled back cleanly).
    assert client.get(f"/api/samples/{_sid(client, 'T7')}").json()["status"] == "backlog"


def test_inversion_is_blocked_regardless_of_drop_order(client):
    """The clashing sample can be dropped last, into the EARLIER slot: T7 lands ▣1 in B01 first,
    then TRAC (bc1, clashes ▣1) is dropped onto A01 and is pushed to ▣2 - loading ▣2 (A01) before
    ▣1 (B01). This drop is refused too, and the message still names TRAC as the culprit (it's the
    one bumped off its natural cell), not T7."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nT1,bc1\nT2,bc2\nTRAC,bc1\nT7,bc7"})
    mon, tue = _weekdays(2)

    _place(client, _sid(client, "T1"), mon, 0, {"mode": "new"})  # ▣1 burns bc1
    _auto(client, _sid(client, "T2"), mon, 1)                    # ▣2 burns bc2

    r7 = _auto(client, _sid(client, "T7"), tue, 1)               # T7 -> ▣1 in B01 (no clash)
    assert r7.status_code == 201, r7.text

    trac = _auto(client, _sid(client, "TRAC"), tue, 0)           # clashes ▣1 -> ▣2 in A01 -> inversion
    assert trac.status_code == 409, trac.text
    assert "TRAC" in trac.json()["detail"] and "T7" not in trac.json()["detail"]
    assert client.get(f"/api/samples/{_sid(client, 'TRAC')}").json()["status"] == "backlog"


def test_reuse_depth_difference_allows_a_later_cell_in_an_earlier_slot(client):
    """The exception the lab owner called out: when two cells differ in reuse depth (one nearer
    its 108h expiry - "most-used first"), a later-position cell legitimately loads in an earlier
    slot. Build a Wednesday plate whose A01 is backed by the more-used ▣2 (Use 3) and whose B01 is
    backed by the less-used ▣1 (Use 2) - a ▣2-before-▣1 order across the slots - and confirm it is
    NOT blocked, because the depths differ (unlike the equal-depth, clash-forced case above)."""
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
    """A plain two-sample plate with no barcode clash and cells in tray order commits normally -
    the guard only fires on a genuine clash-forced inversion, never on ordinary placements."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nP,bp\nQ,bq"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "P"), mon, 0, {"mode": "new"})
    assert r1.status_code == 201
    r2 = _auto(client, _sid(client, "Q"), mon, 1)
    assert r2.status_code == 201, r2.text
    stages = {s["sample_external_id"]: s for s in _stages(r2.json())}
    assert stages["P"]["tray_position"] == 1 and stages["Q"]["tray_position"] == 2
