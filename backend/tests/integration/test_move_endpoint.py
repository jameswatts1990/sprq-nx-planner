"""POST /api/cell-uses/{id}/move: an atomic move of an existing placement to a different
(instrument, day, slot), replacing the old client-side remove-then-place sequence. Cells
cannot move between instruments once they have another use elsewhere."""
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


def _place(client, sample_id, run_date, slot_index=0, cell_choice=None, instrument="84047", run_time_hours=24, start_hour=None):
    payload = {
        "sample_id": sample_id,
        "instrument_serial": instrument,
        "run_date": run_date,
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
        "run_date": run_date,
        "slot_index": slot_index,
        "run_time_hours": run_time_hours,
    }
    if start_hour is not None:
        payload["start_hour"] = start_hour
    if cell_choice is not None:
        payload["cell_choice"] = cell_choice
    return client.post(f"/api/cell-uses/{cell_use_id}/move", json=payload)


def _bootstrap(client, instrument_serial="84047", uses_consumed=0, burned_barcodes=None):
    payload = {
        "uses_consumed": uses_consumed,
        "burned_barcodes": burned_barcodes or [],
        "instrument_serial": instrument_serial,
    }
    resp = client.post("/api/cells/bootstrap", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_move_within_same_instrument_to_a_different_day_and_slot(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    mon, tue = _weekdays(2)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_use_id = r1.json()["stages"][0]["cell_use_id"]
    old_cycle_id = r1.json()["cycle_id"]

    moved = _move(client, cell_use_id, tue, slot_index=3, start_hour=15)
    assert moved.status_code == 200, moved.text
    body = moved.json()
    assert body["run_date"] == tue
    assert body["stages"][0]["slot_index"] == 3
    assert body["cycle_id"] != old_cycle_id

    # the emptied Monday run is cleaned up, same as remove_sample would do
    assert client.get(f"/api/cycles/{old_cycle_id}").status_code == 404


def test_move_across_instruments_rejected_when_cell_has_another_use(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    mon, tue = _weekdays(2)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_id = r1.json()["stages"][0]["cell_id"]
    r2 = _place(client, _sid(client, "A2"), tue, slot_index=0, cell_choice={"mode": "existing", "cell_id": cell_id}, start_hour=15)
    assert r2.status_code == 201, r2.text
    cell_use_id_2 = r2.json()["stages"][0]["cell_use_id"]

    # A2's use of this cell cannot move to a different instrument, since A1's use pins the
    # cell to 84047.
    moved = _move(client, cell_use_id_2, tue, slot_index=1, instrument="84098", start_hour=15)
    assert moved.status_code == 409, moved.text
    assert "instrument" in moved.json()["detail"].lower()


def test_move_across_instruments_allowed_when_it_is_the_cells_only_use(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_use_id = r1.json()["stages"][0]["cell_use_id"]

    # Nothing else pins this cell anywhere yet - a same-day move to a different instrument
    # is equivalent to placing it fresh there, and must be allowed.
    moved = _move(client, cell_use_id, mon, slot_index=0, instrument="84098")
    assert moved.status_code == 200, moved.text
    assert moved.json()["instrument_serial"] == "84098"


def test_move_rejects_slot_already_occupied(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    (mon,) = _weekdays(1)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_use_id = r1.json()["stages"][0]["cell_use_id"]
    # slot 4 (well A02, tray box 2), not slot 1 (well B01) - slot 1 is already an unused
    # sibling of the tray slot 0 just opened, so a "new" placement there would now collide
    # with open_new_tray()'s box guard; slot 4 opens a genuinely separate tray.
    r2 = _place(client, _sid(client, "A2"), mon, slot_index=4)
    assert r2.status_code == 201, r2.text

    moved = _move(client, cell_use_id, mon, slot_index=4)
    assert moved.status_code == 409, moved.text
    assert "occupied" in moved.json()["detail"].lower()


def test_move_dropping_back_onto_its_own_slot_is_a_no_op(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)

    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_use_id = r1.json()["stages"][0]["cell_use_id"]

    moved = _move(client, cell_use_id, mon, slot_index=0)
    assert moved.status_code == 200, moved.text
    assert moved.json()["cycle_id"] == r1.json()["cycle_id"]


def test_move_into_a_run_locked_by_a_prior_run_on_destination_instrument_is_rejected(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2\nA3,bc3"})
    mon, tue = _weekdays(2)

    # Lock up 84098 with an unrelated run starting Monday - both trays loaded, so it's
    # committed to the full movie (noon + 24h + 6h = Tue 18:00), not just the short setup window.
    _place(client, _sid(client, "A1"), mon, slot_index=0, instrument="84098", run_time_hours=24)
    _place(client, _sid(client, "A3"), mon, slot_index=4, instrument="84098", run_time_hours=24)

    # A2 starts on 84047 Monday, then we try to move it onto 84098's Tuesday - still locked
    # by 84098's own Monday run at the default noon start.
    r2 = _place(client, _sid(client, "A2"), mon, slot_index=0, instrument="84047")
    cell_use_id = r2.json()["stages"][0]["cell_use_id"]

    moved = _move(client, cell_use_id, tue, slot_index=0, instrument="84098")
    assert moved.status_code == 409, moved.text
    assert "locked" in moved.json()["detail"].lower()


def _place_a_twice_used_cell(client):
    """A1/A2 share one cell across two uses, both pinned to well A01 - the setup every
    reassignment test below needs, since a cell only becomes well-pinned once it has more
    than one use. Returns (cell_use_id_2, cell_id, tray_id) for A2's use."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    mon, tue = _weekdays(2)
    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    cell_id = r1.json()["stages"][0]["cell_id"]
    tray_id = client.get(f"/api/cells/{cell_id}").json()["tray_id"]
    r2 = _place(client, _sid(client, "A2"), tue, slot_index=0, cell_choice={"mode": "existing", "cell_id": cell_id}, start_hour=15)
    assert r2.status_code == 201, r2.text
    return r2.json()["stages"][0]["cell_use_id"], cell_id, tray_id


def test_move_to_a_different_well_requires_cell_choice(client):
    """The pinned cell can't take a different well - without a cell_choice telling the
    move which different cell to use instead, it must reject with the same "must stay in
    well" signal a plain relocation attempt would."""
    cell_use_id_2, cell_id, _tray_id = _place_a_twice_used_cell(client)
    (wed,) = _weekdays(3)[2:3]

    moved = _move(client, cell_use_id_2, wed, slot_index=1)  # well B01, not A01
    assert moved.status_code == 400, moved.text
    assert "must stay in well" in moved.json()["detail"]
    assert "cell_choice" in moved.json()["detail"]

    # nothing changed - the cell still has both its uses
    assert client.get(f"/api/cells/{cell_id}").json()["uses_consumed"] == 2


def test_move_to_a_different_well_reassigns_sample_to_a_new_cell(client):
    cell_use_id_2, cell_id, _tray_id = _place_a_twice_used_cell(client)
    (wed,) = _weekdays(3)[2:3]

    # slot_index 4 (well A02) opens a genuinely separate tray box from A01-D01.
    moved = _move(client, cell_use_id_2, wed, slot_index=4, cell_choice={"mode": "new"})
    assert moved.status_code == 200, moved.text
    stage = moved.json()["stages"][0]
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
    stage = moved.json()["stages"][0]
    assert stage["cell_id"] == sibling_id
    assert stage["sample_external_id"] == "A2"

    assert client.get(f"/api/cells/{cell_id}").json()["uses_consumed"] == 1
    assert client.get(f"/api/cells/{sibling_id}").json()["uses_consumed"] == 1


def test_move_to_a_different_well_rejects_a_cell_choice_pinned_elsewhere(client):
    cell_use_id_2, _cell_id, tray_id = _place_a_twice_used_cell(client)
    (wed,) = _weekdays(3)[2:3]

    # cell_id's never-yet-used tray sibling reserved for well C01 - not the well this move
    # targets (B01, slot_index=1).
    wrong_sibling_id = next(
        c["id"]
        for c in client.get("/api/cells", params={"tray_id": tray_id}).json()["items"]
        if c["current_well"] == "C01"
    )

    moved = _move(client, cell_use_id_2, wed, slot_index=1, cell_choice={"mode": "existing", "cell_id": wrong_sibling_id})
    assert moved.status_code == 409, moved.text
    assert "must stay in well" in moved.json()["detail"]
