"""POST /api/cell-uses/{id}/move: an atomic move of an existing placement to a different
(instrument, day, slot), replacing the old client-side remove-then-place sequence. A grid
slot is a plate LOADING position, not a cell, but a physical cell is fixed to its own tray
position for life: moving a sample to the *same* loading well on a different day is a plain
same-cell reschedule, while moving it to a *different* loading well - a different slot in the
same tray, a different carousel position, or a different instrument - hands the sample to the
cell the instrument reaches for at the destination (auto-derived, reuse-before-new), never
drags its current cell into a foreign well. The caller may also explicitly override which cell."""
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


def _stages(run):
    """All stages across a run's plates, flattened (plate 1 then plate 2). A single
    placement into slot 0-3 yields one plate; a fresh parallel/second-tray or reuse
    placement adds a second plate."""
    return [s for p in run["plates"] for s in p["stages"]]


def _sid(client, external_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["external_id"] == external_id)


def _place(client, sample_id, run_date, slot_index=0, cell_choice=None, instrument="84047", run_time_hours=24, start_hour=None):
    payload = {
        "sample_id": sample_id,
        "instrument_serial": instrument,
        "load_date": run_date,
        "slot_index": slot_index,
        "cell_choice": cell_choice or {"mode": "new"},
        "run_time_hours": run_time_hours,
    }
    if start_hour is not None:
        payload["start_hour"] = start_hour
    return client.post("/api/cell-uses", json=payload)


def _move(client, cell_use_id, run_date, slot_index=0, instrument="84047", run_time_hours=24, start_hour=None, cell_choice=None):
    payload = {
        "instrument_serial": instrument,
        "load_date": run_date,
        "slot_index": slot_index,
        "run_time_hours": run_time_hours,
    }
    if start_hour is not None:
        payload["start_hour"] = start_hour
    if cell_choice is not None:
        payload["cell_choice"] = cell_choice
    return client.post(f"/api/cell-uses/{cell_use_id}/move", json=payload)


def _sibling_cell_id(client, tray_id, well):
    """An unused sibling cell (current_well == well) of an already-open tray - a "new" placement
    can't land at a well its own tray already occupies, so a same-box, different-well placement
    reuses this sibling instead."""
    items = client.get("/api/cells", params={"tray_id": tray_id, "page_size": 10}).json()["items"]
    return next(c["id"] for c in items if c["current_well"] == well)


def _bootstrap(client, instrument_serial="84047", uses_consumed=0, burned_barcodes=None):
    payload = {
        "uses_consumed": uses_consumed,
        "burned_barcodes": burned_barcodes or [],
        "instrument_serial": instrument_serial,
    }
    resp = client.post("/api/cells/bootstrap", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_move_preserves_the_cells_own_run_time(client):
    """A move re-plans a placement; it must NOT reset the cell's run time to the Run Design
    dial value the client happens to send (that dial only sets run time for *new* placements).
    Place at 30h, move with the request carrying the default 24h, and the moved cell keeps 30h."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    mon, tue = _weekdays(2)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0, run_time_hours=30)
    cell_use_id = _stages(r1.json())[0]["cell_use_id"]
    assert r1.json()["plates"][0]["movie_hours"] == 30

    moved = _move(client, cell_use_id, tue, slot_index=0, run_time_hours=24)  # dial says 24
    assert moved.status_code == 200, moved.text
    body = moved.json()
    assert _stages(body)[0]["run_time_hours"] == 30  # preserved, not reset to 24
    assert body["plates"][0]["movie_hours"] == 30


def test_move_within_same_instrument_to_a_different_day_same_slot(client):
    """A genuine same-well reschedule (day changes, tray position doesn't): the physical
    cell just repositions, no cell_choice needed - this must stay a plain in-place move."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    mon, tue = _weekdays(2)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_use_id = _stages(r1.json())[0]["cell_use_id"]
    cell_id = _stages(r1.json())[0]["cell_id"]
    old_cycle_id = r1.json()["run_id"]

    moved = _move(client, cell_use_id, tue, slot_index=0, start_hour=15)
    assert moved.status_code == 200, moved.text
    body = moved.json()
    assert body["load_date"] == tue
    assert _stages(body)[0]["slot_index"] == 0
    assert _stages(body)[0]["cell_id"] == cell_id
    assert body["run_id"] != old_cycle_id

    # the emptied Monday run is cleaned up, same as remove_sample would do
    assert client.get(f"/api/cycles/{old_cycle_id}").status_code == 404


def test_move_to_a_different_slot_in_the_same_carousel_position_reassigns_the_cell(client):
    """A grid slot is a plate loading position, but a physical cell is fixed to its own tray
    position for life - so moving a sample to a *different* slot in the same carousel position
    hands it to the cell the instrument reaches for at that slot (reuse-before-new), never drags
    its current cell into a foreign well. A1's fresh cell A is released; A1 adopts cell B, which
    lives at the destination well B01."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_use_id = _stages(r1.json())[0]["cell_use_id"]
    cell_a = _stages(r1.json())[0]["cell_id"]
    assert _stages(r1.json())[0]["cell_home_well"] == "A01"

    # A plain move to slot 1 (well B01, same Plate-1 carousel position) reassigns to B01's cell.
    moved = _move(client, cell_use_id, mon, slot_index=1)
    assert moved.status_code == 200, moved.text
    stage = _stages(moved.json())[0]
    assert stage["slot_index"] == 1
    assert stage["well"] == "B01"  # the plate loading position it moved to
    assert stage["cell_id"] != cell_a  # reassigned - not the old cell dragged into a foreign well
    assert stage["cell_home_well"] == "B01"  # now on cell B, in cell B's own slot (stub "B1")
    assert stage["sample_external_id"] == "A1"
    # cell A is released back to 0 uses - still open, still the earliest cell for slot A01.
    assert client.get(f"/api/cells/{cell_a}").json()["uses_consumed"] == 0


def test_move_within_a_box_cannot_strand_a_fresh_cell_out_of_slot_a01(client):
    """Regression (reported 2026-07-26): dragging cards between slots in one tray must never
    leave a fresh cell stranded in a foreign slot, so that slot A01 shows a *later* cell (cell B
    Use 1) while cell A still has capacity. Because a move reassigns to the destination slot's
    own cell (rather than rewriting the loading well while keeping the cell), slot A01 always
    draws the earliest cell with capacity - cell A here."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nT12,bc12\nT10,bc10"})
    (mon,) = _weekdays(1)

    # T12 lands on the earliest cell (cell A) in slot A01.
    r1 = _place(client, _sid(client, "T12"), mon, slot_index=0)
    t12_use = _stages(r1.json())[0]["cell_use_id"]
    cell_a = _stages(r1.json())[0]["cell_id"]
    assert _stages(r1.json())[0]["cell_home_well"] == "A01"

    # Drag T12 down to the empty B01: it adopts cell B and frees cell A (not "cell A now in B01").
    moved = _move(client, t12_use, mon, slot_index=1)
    assert moved.status_code == 200, moved.text
    assert client.get(f"/api/cells/{cell_a}").json()["uses_consumed"] == 0

    # Now load T10 into the freed A01 with a plain drop (no cell_choice -> server auto-derives):
    # it MUST draw cell A (earliest with capacity), never cell B.
    r2 = client.post(
        "/api/cell-uses",
        json={
            "sample_id": _sid(client, "T10"),
            "instrument_serial": "84047",
            "load_date": mon,
            "slot_index": 0,
            "run_time_hours": 24,
        },
    )
    assert r2.status_code == 201, r2.text
    a01 = next(s for s in _stages(r2.json()) if s["slot_index"] == 0)
    assert a01["cell_id"] == cell_a
    assert a01["cell_home_well"] == "A01"  # stub "A1" - the reported "B1 in slot A01" bug is gone
    assert a01["sample_external_id"] == "T10"


def test_move_to_a_different_carousel_position_reuses_an_idle_sibling_of_its_own_tray(client):
    """Moving a Plate-1 sample to a Plate-2 slot hands it to the cell the instrument reaches for
    there (reuse-before-new). A cell is pinned to its tray POSITION, not a plate box, so - rather
    than opening a fresh SECOND tray - the drag reuses an idle sibling of the sample's OWN tray,
    loaded into the Plate-2 well (docs/pacbio-sprq-nx-scheduling-reference.md's "Plate vs cell").
    No cell_choice needed - a plain drag just works."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_use_id = _stages(r1.json())[0]["cell_use_id"]
    cell_id = _stages(r1.json())[0]["cell_id"]
    tray_id = client.get(f"/api/cells/{cell_id}").json()["tray_id"]

    moved = _move(client, cell_use_id, mon, slot_index=4)
    assert moved.status_code == 200, moved.text
    stage = next(s for s in _stages(moved.json()) if s["sample_external_id"] == "A1")
    new_cell_id = stage["cell_id"]
    assert new_cell_id != cell_id  # handed to a different cell...
    assert stage["slot_index"] == 4
    assert stage["well"] == "A02"  # ...loaded into the Plate-2 well

    # reuse-before-new across plate positions: the sample lands on an idle sibling of its OWN
    # physical tray, not a freshly opened second tray.
    assert client.get(f"/api/cells/{new_cell_id}").json()["tray_id"] == tray_id


def test_move_across_instruments_reassigns_to_a_new_cell_when_cell_has_another_use(client):
    """A physical cell already pinned to 84047 by A1's use still can never cross to 84098 -
    but the *sample* isn't physically loaded onto anything until its run executes, so
    dragging A2's use there is just re-planning: it must hand A2 to a (possibly new) cell on
    the destination instrument, exactly like the same-instrument well-conflict case, rather
    than being hard-rejected."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    mon, tue = _weekdays(2)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_id = _stages(r1.json())[0]["cell_id"]
    r2 = _place(client, _sid(client, "A2"), tue, slot_index=0, cell_choice={"mode": "existing", "cell_id": cell_id}, start_hour=15)
    assert r2.status_code == 201, r2.text
    cell_use_id_2 = _stages(r2.json())[0]["cell_use_id"]

    # A plain drag onto 84098 auto-reassigns A2 to a fresh cell there (a cell never crosses
    # instruments; the unexecuted sample is just re-planned) - A1's cell and its pin on 84047
    # are untouched, and A2 never bounces through backlog in between.
    moved = _move(client, cell_use_id_2, tue, slot_index=1, instrument="84098", start_hour=15)
    assert moved.status_code == 200, moved.text
    stage = next(s for s in _stages(moved.json()) if s["sample_external_id"] == "A2")
    new_cell_id = stage["cell_id"]
    assert new_cell_id != cell_id

    assert client.get(f"/api/cells/{cell_id}").json()["uses_consumed"] == 1
    assert client.get(f"/api/cells/{new_cell_id}").json()["uses_consumed"] == 1
    assert client.get("/api/samples", params={"status": "scheduled"}).json()["total"] == 2
    assert client.get("/api/samples", params={"status": "backlog"}).json()["total"] == 0


def test_move_across_instruments_reassigns_to_a_new_cell_even_as_the_cells_only_use(client):
    """The bug this fix closes: with nothing else pinning it, a single-use cell's own
    CellUse.cycle previously got silently rewritten onto the destination instrument's cycle
    - the physical cell's tray never actually moved, so its derived pin would then disagree
    with where its own use said it was. Even a cell's only use must reassign to a (possibly
    new) cell on the destination instrument instead, same as when other uses pin it."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_use_id = _stages(r1.json())[0]["cell_use_id"]
    cell_id = _stages(r1.json())[0]["cell_id"]

    # A plain drag onto a different instrument auto-hands the sample to a fresh cell on 84098
    # (the physical cell can never cross instruments).
    moved = _move(client, cell_use_id, mon, slot_index=0, instrument="84098")
    assert moved.status_code == 200, moved.text
    assert moved.json()["instrument_serial"] == "84098"
    new_cell_id = _stages(moved.json())[0]["cell_id"]
    assert new_cell_id != cell_id

    # The old cell had no other real use anywhere, so its whole (never-otherwise-touched)
    # tray is cleaned up, same as remove_sample would do.
    assert client.get(f"/api/cells/{cell_id}").status_code == 404


def test_move_rejects_slot_already_occupied(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    (mon,) = _weekdays(1)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_use_id = _stages(r1.json())[0]["cell_use_id"]
    # slot 4 (well A02, tray box 2), not slot 1 (well B01) - slot 1 is already an unused
    # sibling of the tray slot 0 just opened, so a "new" placement there would now collide
    # with open_new_tray()'s box guard; slot 4 opens a genuinely separate tray.
    r2 = _place(client, _sid(client, "A2"), mon, slot_index=4)
    assert r2.status_code == 201, r2.text

    # Slot 4 (well A02) is genuinely taken by A2's real, active use on this run: a move onto it
    # is rejected as an occupied slot, whichever cell the sample would land on.
    moved = _move(client, cell_use_id, mon, slot_index=4)
    assert moved.status_code == 409, moved.text
    assert "occupied" in moved.json()["detail"].lower()


def test_move_dropping_back_onto_its_own_slot_is_a_no_op(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_use_id = _stages(r1.json())[0]["cell_use_id"]

    moved = _move(client, cell_use_id, mon, slot_index=0)
    assert moved.status_code == 200, moved.text
    assert moved.json()["run_id"] == r1.json()["run_id"]


def test_move_into_a_run_locked_by_a_prior_run_on_destination_instrument_is_rejected(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,b1\nA2,b2\nA3,b3\nA4,b4\nA5,b5\nA6,b6"})
    mon, tue = _weekdays(2)

    # Lock up 84098 with an unrelated run starting Monday - a full first tray + a second-tray cell,
    # 30h, at 20:00. Its last cell finishes prep ~38h in = Mon 20:00 + 38h = Wed ~10:00, so all of
    # Tuesday is inside the loading lock (a lock that merely cleared mid-Tuesday would leave Tuesday
    # loadable - see the placement tests). It takes a second tray for the ladder to span a full day.
    r0 = _place(client, _sid(client, "A1"), mon, slot_index=0, instrument="84098", run_time_hours=30, start_hour=20)
    tray_id = _stages(r0.json())[0]["tray_id"]
    for i, (ext, well) in enumerate([("A3", "B01"), ("A4", "C01"), ("A5", "D01")], start=1):
        sib = _sibling_cell_id(client, tray_id, well)
        _place(
            client, _sid(client, ext), mon, slot_index=i, instrument="84098", run_time_hours=30, start_hour=20,
            cell_choice={"mode": "existing", "cell_id": sib},
        )
    _place(client, _sid(client, "A6"), mon, slot_index=4, instrument="84098", run_time_hours=30, start_hour=20)

    # A2 starts on 84047 Monday, then we try to move it onto 84098's Tuesday - fully occupied
    # by 84098's own Monday run.
    r2 = _place(client, _sid(client, "A2"), mon, slot_index=0, instrument="84047")
    cell_use_id = _stages(r2.json())[0]["cell_use_id"]

    # well A01 on 84098 already has its own real resident (A1's cell), so a cell_choice is
    # required to even attempt this move - but the destination run is locked regardless of
    # which cell is chosen, and that check must win before the cell is ever touched.
    moved = _move(client, cell_use_id, tue, slot_index=0, instrument="84098", cell_choice={"mode": "new"})
    assert moved.status_code == 409, moved.text
    assert "locked" in moved.json()["detail"].lower()


def _place_a_twice_used_cell(client):
    """A1/A2 share one cell across two uses, both pinned to well A01 - the setup every
    reassignment test below needs, since a cell only becomes well-pinned once it has more
    than one use. Returns (cell_use_id_2, cell_id, tray_id) for A2's use."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    mon, tue = _weekdays(2)
    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_id = _stages(r1.json())[0]["cell_id"]
    tray_id = client.get(f"/api/cells/{cell_id}").json()["tray_id"]
    r2 = _place(client, _sid(client, "A2"), tue, slot_index=0, cell_choice={"mode": "existing", "cell_id": cell_id}, start_hour=15)
    assert r2.status_code == 201, r2.text
    return _stages(r2.json())[0]["cell_use_id"], cell_id, tray_id


def test_move_to_a_different_well_in_the_same_position_reassigns_to_the_sibling_there(client):
    """A twice-used cell dragged to a different well in the same Plate-1 carousel position is
    handed to the cell resident at that well (its fresh tray sibling), not dragged into a foreign
    well - a physical cell stays in its own tray position for life. Its own earlier use stays put."""
    cell_use_id_2, cell_id, _tray_id = _place_a_twice_used_cell(client)
    (wed,) = _weekdays(3)[2:3]

    moved = _move(client, cell_use_id_2, wed, slot_index=1)  # well B01, same Plate-1 position
    assert moved.status_code == 200, moved.text
    stage = _stages(moved.json())[0]
    assert stage["well"] == "B01"
    assert stage["cell_id"] != cell_id  # reassigned to B01's own resident sibling
    assert stage["cell_home_well"] == "B01"  # cell B's identity, stub "B1"
    assert stage["sample_external_id"] == "A2"

    # the original (twice-used) cell keeps only its first use now; A2 moved off it
    assert client.get(f"/api/cells/{cell_id}").json()["uses_consumed"] == 1


def test_move_to_a_different_well_reassigns_sample_to_a_new_cell(client):
    cell_use_id_2, cell_id, _tray_id = _place_a_twice_used_cell(client)
    (wed,) = _weekdays(3)[2:3]

    # slot_index 4 (well A02) opens a genuinely separate tray box from A01-D01.
    moved = _move(client, cell_use_id_2, wed, slot_index=4, cell_choice={"mode": "new"})
    assert moved.status_code == 200, moved.text
    stage = _stages(moved.json())[0]
    assert stage["slot_index"] == 4
    assert stage["sample_external_id"] == "A2"
    new_cell_id = stage["cell_id"]
    assert new_cell_id != cell_id

    # the sample never bounced through backlog - it's still scheduled throughout
    assert client.get("/api/samples", params={"status": "scheduled"}).json()["total"] == 2
    assert client.get("/api/samples", params={"status": "backlog"}).json()["total"] == 0

    # the original cell keeps its one remaining use (A1's); the new cell has A2's
    original_cell = client.get(f"/api/cells/{cell_id}").json()
    assert original_cell["uses_consumed"] == 1
    assert original_cell["status"] == "open"
    assert client.get(f"/api/cells/{new_cell_id}").json()["uses_consumed"] == 1


def test_move_to_a_different_well_reassigns_sample_to_an_existing_compatible_cell(client):
    cell_use_id_2, cell_id, tray_id = _place_a_twice_used_cell(client)
    (wed,) = _weekdays(3)[2:3]

    # cell_id's never-yet-used tray sibling reserved for well B01 - already open, already
    # pinned to exactly the well this move targets.
    sibling_id = next(
        c["id"]
        for c in client.get("/api/cells", params={"tray_id": tray_id}).json()["items"]
        if c["current_well"] == "B01"
    )

    moved = _move(client, cell_use_id_2, wed, slot_index=1, cell_choice={"mode": "existing", "cell_id": sibling_id})
    assert moved.status_code == 200, moved.text
    stage = _stages(moved.json())[0]
    assert stage["cell_id"] == sibling_id
    assert stage["sample_external_id"] == "A2"

    assert client.get(f"/api/cells/{cell_id}").json()["uses_consumed"] == 1
    assert client.get(f"/api/cells/{sibling_id}").json()["uses_consumed"] == 1


def test_move_can_override_onto_any_sibling_in_the_same_carousel_position(client):
    """An explicit cell_choice can hand the sample to any open sibling in the same carousel
    position, regardless of that sibling's own tray letter - the sample lands in the dropped
    slot (B01) while running on the chosen cell (identity C01, stub "C1")."""
    cell_use_id_2, cell_id, tray_id = _place_a_twice_used_cell(client)
    (wed,) = _weekdays(3)[2:3]

    # cell_id's never-yet-used tray sibling reserved for well C01 - a different tray letter than
    # the slot this move targets (B01, slot_index=1), but the same Plate-1 carousel position.
    other_sibling_id = next(
        c["id"]
        for c in client.get("/api/cells", params={"tray_id": tray_id}).json()["items"]
        if c["current_well"] == "C01"
    )

    moved = _move(client, cell_use_id_2, wed, slot_index=1, cell_choice={"mode": "existing", "cell_id": other_sibling_id})
    assert moved.status_code == 200, moved.text
    stage = _stages(moved.json())[0]
    assert stage["cell_id"] == other_sibling_id
    assert stage["well"] == "B01"  # the plate loading position it was dropped onto
    assert stage["cell_home_well"] == "C01"  # the chosen cell's identity, stub shows "C1"
    assert client.get(f"/api/cells/{cell_id}").json()["uses_consumed"] == 1  # A2's use left it


def test_move_onto_a_well_whose_tray_has_since_turned_over(client):
    """Reproduces the exact reported bug: a well's physical tray can genuinely turn over
    over time (the old tray goes fully terminal, a brand-new one loads into the same box
    later) - moving an unrelated sample onto that well must resolve to whichever cell is
    truly resident *now* (the new tray), never the moved sample's own prior cell, and
    never the old, now-terminal tray's cell."""
    client.post(
        "/api/imports",
        json={"raw_text": "sample,barcodes\nOLD1,bc1\nOLD2,bc2\nOLD3,bc3\nNEW1,bcn\nX,bcx"},
    )
    mon, tue, wed, thu, fri = _weekdays(5)

    # OLD's tray at well A01: 3 real (still-planned) uses exhausts the A01 cell; its 3
    # never-used siblings are discarded individually so the whole physical tray box is
    # genuinely vacated (every cell in it non-open).
    r_old = _place(client, _sid(client, "OLD1"), mon, slot_index=0)
    old_cell_id = _stages(r_old.json())[0]["cell_id"]
    tray_id = client.get(f"/api/cells/{old_cell_id}").json()["tray_id"]
    _place(client, _sid(client, "OLD2"), tue, slot_index=0, cell_choice={"mode": "existing", "cell_id": old_cell_id}, start_hour=15)
    _place(client, _sid(client, "OLD3"), wed, slot_index=0, cell_choice={"mode": "existing", "cell_id": old_cell_id}, start_hour=15)
    assert client.get(f"/api/cells/{old_cell_id}").json()["status"] == "exhausted"

    siblings = [
        c["id"] for c in client.get("/api/cells", params={"tray_id": tray_id}).json()["items"] if c["id"] != old_cell_id
    ]
    assert len(siblings) == 3
    for sibling_id in siblings:
        resp = client.post(f"/api/cells/{sibling_id}/discard", json={"reason": "test cleanup"})
        assert resp.status_code == 200, resp.text

    # A brand-new tray now loads into the same physical box, well A01, on Thursday - tray1
    # wells only, so it just holds the instrument for the short setup buffer.
    r_new = _place(client, _sid(client, "NEW1"), thu, slot_index=0, start_hour=15)
    new_cell_id = _stages(r_new.json())[0]["cell_id"]
    assert new_cell_id != old_cell_id

    # X is scheduled on a completely different instrument, then dragged onto 84047's well
    # A01 on Friday - a day still within the new tray's cell's remaining capacity. The plain
    # drag auto-resolves to whichever cell is truly resident *now* (the new tray's cell), never
    # X's own prior cell, and never the old, now-terminal cell that used to sit in this well.
    r_x = _place(client, _sid(client, "X"), mon, slot_index=0, instrument="84098")
    x_cell_use_id = _stages(r_x.json())[0]["cell_use_id"]

    moved = _move(client, x_cell_use_id, fri, slot_index=0, instrument="84047")
    assert moved.status_code == 200, moved.text
    stage = next(s for s in _stages(moved.json()) if s["sample_external_id"] == "X")
    assert stage["cell_id"] == new_cell_id  # the current resident (new tray), reused as Use 2
    assert stage["cell_id"] != old_cell_id
    assert stage["use_number"] == 2
    assert client.get(f"/api/cells/{new_cell_id}").json()["uses_consumed"] == 2
