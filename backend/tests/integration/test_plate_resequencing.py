"""Plate re-sequencing (lab-owner model, 2026-08-07): within one plate, the occupied wells read
in order (A->B->C->D) must always be backed by the plate's cells in reuse-priority order
(expiring-first, then tray sequence 1,2,3,4). So a plate can never read an out-of-order cell
number (the forbidden A=1,B=4,C=3,D=2 state), and inserting a sample in an earlier well
re-sequences the later ones - exactly the reported "cell number went out of sync" bug. Every
drop takes the NEXT-AVAILABLE cell regardless of the plate well it lands on; nothing is ever
rerouted to dodge a clash. See placement_service._resequence_plate / _fresh_tray_cell and
docs/pacbio-sprq-nx-scheduling-reference.md's "Sequential wells take sequential cells".
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


def _sid(client, pool_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["pool_id"] == pool_id)


def _stages(run):
    return [s for p in run["plates"] for s in p["stages"]]


def _drop(client, sample_id, run_date, slot_index, instrument="84047"):
    """A plain drag-drop: no cell_choice, no run_time_hours - the engine derives the cell."""
    return client.post("/api/cell-uses", json={
        "sample_id": sample_id, "instrument_serial": instrument,
        "load_date": run_date, "slot_index": slot_index,
    })


def _tray_positions_by_well(run):
    """{well -> tray_position (the ▣N stub number)} across the whole run."""
    return {s["well"]: s["tray_position"] for s in _stages(run)}


def test_out_of_order_drops_resequence_to_ascending(client):
    """The lab owner's own example: drop A, then C, then B. Each drop takes the next available
    cell, and inserting B re-sequences so the plate reads A=1, B=2, C=3 - never A=1, B=3, C=2."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nSA,ba\nSB,bb\nSC,bc"})
    (mon,) = _weekdays(1)

    r_a = _drop(client, _sid(client, "SA"), mon, 0)  # A01
    assert r_a.status_code == 201, r_a.text
    r_c = _drop(client, _sid(client, "SC"), mon, 2)  # C01 -> next available = cell 2
    assert r_c.status_code == 201, r_c.text
    assert _tray_positions_by_well(r_c.json()) == {"A01": 1, "C01": 2}

    r_b = _drop(client, _sid(client, "SB"), mon, 1)  # B01 inserted -> re-sequence
    assert r_b.status_code == 201, r_b.text
    assert _tray_positions_by_well(r_b.json()) == {"A01": 1, "B01": 2, "C01": 3}
    # and the samples never moved wells - only which cell backs each well re-sequenced
    by_well_sample = {s["well"]: s["sample_pool_id"] for s in _stages(r_b.json())}
    assert by_well_sample == {"A01": "SA", "B01": "SB", "C01": "SC"}


def test_forbidden_descending_state_is_unreachable(client):
    """Filling wells in the order A, D, C, B - the sequence that used to produce the reported
    A=1, B=4, C=3, D=2 inversion - now always reads strictly ascending 1,2,3,4 across wells."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nSA,ba\nSB,bb\nSC,bc\nSD,bd"})
    (mon,) = _weekdays(1)
    for ext, slot in [("SA", 0), ("SD", 3), ("SC", 2), ("SB", 1)]:
        r = _drop(client, _sid(client, ext), mon, slot)
        assert r.status_code == 201, r.text

    assert _tray_positions_by_well(r.json()) == {"A01": 1, "B01": 2, "C01": 3, "D01": 4}


def test_lone_drop_on_a_later_well_takes_the_first_cell(client):
    """"The well takes the next available cell regardless of plate position": a lone drop onto
    C01 of a fresh tray runs on cell 1 (▣1), not the position-matched cell 3."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nSC,bc"})
    (mon,) = _weekdays(1)
    r = _drop(client, _sid(client, "SC"), mon, 2)  # C01
    assert r.status_code == 201, r.text
    stage = _stages(r.json())[0]
    assert stage["well"] == "C01"
    assert stage["tray_position"] == 1  # ▣1 - next available, not the C-position cell


def test_moving_a_card_between_wells_keeps_the_plate_ascending(client):
    """The reported bug end to end: two samples placed, then one dragged to another well. The
    plate stays ascending across its wells and no cell number goes out of sync."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nSA,ba\nSB,bb"})
    (mon,) = _weekdays(1)
    r_a = _drop(client, _sid(client, "SA"), mon, 0)  # A01 -> ▣1
    r_b = _drop(client, _sid(client, "SB"), mon, 1)  # B01 -> ▣2
    assert _tray_positions_by_well(r_b.json()) == {"A01": 1, "B01": 2}

    sb_use = next(s["cell_use_id"] for s in _stages(r_b.json()) if s["sample_pool_id"] == "SB")
    # Drag SB from B01 to the empty D01.
    moved = client.post(f"/api/cell-uses/{sb_use}/move", json={
        "instrument_serial": "84047", "load_date": mon, "slot_index": 3, "run_time_hours": 24,
    })
    assert moved.status_code == 200, moved.text
    # A01 keeps ▣1, D01 reads ▣2 - ascending across the two occupied wells, nothing transposed.
    assert _tray_positions_by_well(moved.json()) == {"A01": 1, "D01": 2}


def test_second_run_reuses_the_first_expiring_cells_in_ascending_order(client):
    """The lab owner's reuse example: Run 1 uses wells A+B (cells 1,2). Run 2 the next day uses
    wells C+D and reuses those same first-expiring cells - reading ascending C=1, D=2 (their own
    ▣1, ▣2), reuse-before-new, no fresh tray opened."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nR1A,a1\nR1B,b1\nR2C,c2\nR2D,d2"})
    mon, tue = _weekdays(2)

    _drop(client, _sid(client, "R1A"), mon, 0)  # A01 -> ▣1
    r1b = _drop(client, _sid(client, "R1B"), mon, 1)  # B01 -> ▣2
    cell1 = next(s["cell_id"] for s in _stages(r1b.json()) if s["well"] == "A01")
    cell2 = next(s["cell_id"] for s in _stages(r1b.json()) if s["well"] == "B01")

    _drop(client, _sid(client, "R2C"), tue, 2)  # C01, Tue -> reuse ▣1
    r2d = _drop(client, _sid(client, "R2D"), tue, 3)  # D01, Tue -> reuse ▣2
    assert r2d.status_code == 201, r2d.text
    by_well_cell = {s["well"]: s["cell_id"] for s in _stages(r2d.json())}
    assert by_well_cell == {"C01": cell1, "D01": cell2}  # reused the first-expiring cells
    assert _tray_positions_by_well(r2d.json()) == {"C01": 1, "D01": 2}  # ascending
