"""Day notes pinned to instruments in the Schedule grid: create on several instruments, list by
date range, edit text + unpin an instrument, delete, validation, and the audit trail."""


def _ids(client, *serials: str) -> list[int]:
    by_serial = {i["serial_number"]: i["id"] for i in client.get("/api/instruments").json()}
    return [by_serial[s] for s in serials]


def _create(client, note_date="2026-10-19", body="Engineer visit - don't load before 14:00", serials=("84047",)):
    return client.post(
        "/api/schedule-notes",
        json={"note_date": note_date, "body": body, "instrument_ids": _ids(client, *serials)},
    )


def test_create_note_on_several_instruments_and_list_by_range(client):
    res = _create(client, serials=("84093", "84047"))
    assert res.status_code == 201, res.text
    note = res.json()
    assert note["note_date"] == "2026-10-19"
    assert note["body"] == "Engineer visit - don't load before 14:00"
    # Serial order, so the grid and the edit modal read consistently.
    assert note["instrument_serials"] == ["84047", "84093"]

    assert _create(client, note_date="2026-10-26", body="next week").status_code == 201

    week = client.get("/api/schedule-notes", params={"date_from": "2026-10-19", "date_to": "2026-10-23"}).json()
    assert [n["id"] for n in week] == [note["id"]]
    assert len(client.get("/api/schedule-notes").json()) == 2


def test_edit_note_text_and_unpin_an_instrument(client):
    note = _create(client, serials=("84047", "84093")).json()

    res = client.put(
        f"/api/schedule-notes/{note['id']}",
        json={"body": "  Engineer moved to Tue  ", "instrument_ids": _ids(client, "84093")},
    )
    assert res.status_code == 200, res.text
    assert res.json()["body"] == "Engineer moved to Tue"
    assert res.json()["instrument_serials"] == ["84093"]
    # The day is fixed once created.
    assert res.json()["note_date"] == "2026-10-19"


def test_delete_note(client):
    note = _create(client).json()
    assert client.delete(f"/api/schedule-notes/{note['id']}").status_code == 204
    assert client.get("/api/schedule-notes").json() == []
    assert client.delete(f"/api/schedule-notes/{note['id']}").status_code == 404


def test_note_needs_text_and_at_least_one_existing_instrument(client):
    assert _create(client, body="   ").status_code == 400
    assert _create(client, body="x" * 501).status_code == 400
    assert _create(client, serials=()).status_code == 400

    unknown = client.post(
        "/api/schedule-notes", json={"note_date": "2026-10-19", "body": "hi", "instrument_ids": [99999]}
    )
    assert unknown.status_code == 400
    assert client.get("/api/schedule-notes").json() == []

    note = _create(client).json()
    blank_edit = client.put(f"/api/schedule-notes/{note['id']}", json={"body": "ok", "instrument_ids": []})
    assert blank_edit.status_code == 400
    # A refused edit leaves the note as it was.
    assert client.get("/api/schedule-notes").json()[0]["instrument_serials"] == ["84047"]


def test_note_actions_are_audit_logged(client):
    note = _create(client).json()
    client.put(f"/api/schedule-notes/{note['id']}", json={"body": "changed", "instrument_ids": note["instrument_ids"]})
    client.delete(f"/api/schedule-notes/{note['id']}")

    audit = client.get("/api/audit-log", params={"entity_type": "schedule_note", "entity_id": note["id"]}).json()
    rows = {row["action"]: row["details_json"] for row in audit["items"]}
    assert set(rows) == {"create_schedule_note", "update_schedule_note", "delete_schedule_note"}
    assert rows["update_schedule_note"] == {
        "body": {"from": "Engineer visit - don't load before 14:00", "to": "changed"}
    }
    assert rows["delete_schedule_note"]["body"] == "changed"


def test_deleting_an_instrument_unpins_it_from_notes(client):
    spare = client.post("/api/instruments", json={"serial_number": "99999"}).json()
    note = client.post(
        "/api/schedule-notes",
        json={"note_date": "2026-10-19", "body": "shared", "instrument_ids": [spare["id"], *_ids(client, "84047")]},
    ).json()
    assert note["instrument_serials"] == ["84047", "99999"]

    assert client.delete(f"/api/instruments/{spare['id']}").status_code == 204
    assert client.get("/api/schedule-notes").json()[0]["instrument_serials"] == ["84047"]


def _move(client, note, note_date, from_serial, to_serial):
    return client.post(
        f"/api/schedule-notes/{note['id']}/move",
        json={"note_date": note_date, "from_instrument_serial": from_serial, "to_instrument_serial": to_serial},
    )


def test_drag_note_to_another_day_moves_it_on_every_instrument(client):
    note = _create(client, serials=("84047", "84093")).json()

    res = _move(client, note, "2026-10-21", "84047", "84047")
    assert res.status_code == 200, res.text
    assert res.json()["note_date"] == "2026-10-21"
    assert res.json()["instrument_serials"] == ["84047", "84093"]
    assert res.json()["body"] == note["body"]


def test_drag_note_to_another_instrument_swaps_just_that_row(client):
    spare = client.post("/api/instruments", json={"serial_number": "99999"}).json()
    note = _create(client, serials=("84047", "84093")).json()

    res = _move(client, note, "2026-10-20", "84047", spare["serial_number"])
    assert res.status_code == 200, res.text
    assert res.json()["note_date"] == "2026-10-20"
    assert res.json()["instrument_serials"] == ["84093", "99999"]

    # Onto a row the note is already on: the two copies merge rather than duplicating.
    merged = _move(client, res.json(), "2026-10-20", "99999", "84093").json()
    assert merged["instrument_serials"] == ["84093"]


def test_move_keeps_a_concurrent_text_edit_and_refuses_an_unknown_instrument(client):
    note = _create(client).json()
    client.put(f"/api/schedule-notes/{note['id']}", json={"body": "edited elsewhere", "instrument_ids": note["instrument_ids"]})

    moved = _move(client, note, "2026-10-22", "84047", "84047").json()
    assert moved["body"] == "edited elsewhere"

    assert _move(client, note, "2026-10-23", "84047", "nope").status_code == 400
    assert client.get("/api/schedule-notes").json()[0]["note_date"] == "2026-10-22"
    assert _move(client, {"id": 99999}, "2026-10-23", "84047", "84047").status_code == 404


def test_note_move_is_audit_logged(client):
    note = _create(client, serials=("84047", "84093")).json()
    _move(client, note, "2026-10-21", "84093", "84047")

    audit = client.get("/api/audit-log", params={"entity_type": "schedule_note", "entity_id": note["id"]}).json()
    rows = {row["action"]: row["details_json"] for row in audit["items"]}
    assert rows["move_schedule_note"] == {
        "note_date": {"from": "2026-10-19", "to": "2026-10-21"},
        "instruments": {"from": ["84047", "84093"], "to": ["84047"]},
    }
