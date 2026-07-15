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


def _move(client, cell_use_id, run_date, slot_index=0, instrument="84047", run_time_hours=24, start_hour=None):
    payload = {
        "instrument_serial": instrument,
        "run_date": run_date,
        "slot_index": slot_index,
        "run_time_hours": run_time_hours,
    }
    if start_hour is not None:
        payload["start_hour"] = start_hour
    return client.post(f"/api/cell-uses/{cell_use_id}/move", json=payload)


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
    _place(client, _sid(client, "A2"), mon, slot_index=1)

    moved = _move(client, cell_use_id, mon, slot_index=1)
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
