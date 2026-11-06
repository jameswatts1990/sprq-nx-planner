"""Who changed what (persona review B1): the operator name sent as the X-RunNx-Actor header, the
before→after diffs on sample / instrument / placement-note edits, the import row, and the Activity
page's read side - related-entity filters, links and the "Who" list."""
from datetime import date, timedelta
from urllib.parse import quote


def _monday() -> str:
    d = date.today() + timedelta(days=1)
    while d.weekday() != 0:
        d += timedelta(days=1)
    return d.isoformat()


def _import(client, text: str = "sample,barcodes\nA1,bc1", **headers):
    resp = client.post("/api/imports", json={"raw_text": text}, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _place(client, sample_id: int, slot_index: int = 0, cell_choice: dict | None = None):
    resp = client.post(
        "/api/cell-uses",
        json={
            "sample_id": sample_id,
            "instrument_serial": "84047",
            "load_date": _monday(),
            "slot_index": slot_index,
            "cell_choice": cell_choice or {"mode": "new"},
            "run_time_hours": 24,
            "max_uses": 3,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


_EDIT_FIELDS = (
    "sanger_ids",
    "plate_id",
    "target_oplc",
    "actual_oplc",
    "cleaned_complex_volume",
    "loading_buffer_volume",
    "adaptive_loading",
    "full_resolution_base_q",
    "priority",
    "base_kinetics",
    "movie_time_hours",
    "insert_size_bp",
)


def _audit(client, **params):
    resp = client.get("/api/audit-log", params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()["items"]


def test_actor_header_names_the_change_and_survives_non_ascii(client):
    name = "Zoë O'Brien"
    _import(client, **{"X-RunNx-Actor": quote(name)})
    (row,) = _audit(client, action="import_samples")
    assert row["actor"] == name


def test_actor_precedence_body_then_query_then_header(client):
    sample_id = _import(client)["samples"][0]["id"]
    headers = {"X-RunNx-Actor": "Header Name"}

    client.patch(f"/api/samples/{sample_id}/notes", json={"notes": "one"}, headers=headers)
    client.patch(f"/api/samples/{sample_id}/notes", params={"actor": "Query Name"}, json={"notes": "two"}, headers=headers)
    client.patch(f"/api/samples/{sample_id}/notes", json={"notes": "three"})
    rows = _audit(client, action="update_sample_notes")
    assert [r["actor"] for r in rows] == ["unknown", "Query Name", "Header Name"]

    # A body actor (the Batch Sheet's "Your name") beats the header.
    run = _place(client, sample_id)
    resp = client.patch(
        f"/api/cycles/{run['run_id']}", json={"status": "running", "actor": "Body Name"}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    (row,) = _audit(client, action="update_run_status")
    assert row["actor"] == "Body Name"


def test_sample_edit_records_before_and_after_and_skips_a_no_op(client):
    sample = _import(client)["samples"][0]
    sample_id = sample["id"]
    # The edit form always sends every field; only barcodes and priority differ here.
    edit = {k: sample[k] for k in _EDIT_FIELDS} | {"barcodes": ["bc1", "bc9"], "priority": "High (1)"}
    assert client.patch(f"/api/samples/{sample_id}", json=edit).status_code == 200

    (row,) = _audit(client, action="update_sample")
    assert row["details_json"] == {
        "barcodes": {"from": ["bc1"], "to": ["bc1", "bc9"]},
        "priority": {"from": sample["priority"], "to": "High (1)"},
    }
    assert row["links"] == [{"kind": "sample", "id": sample_id, "label": "A1"}]

    # Saving the same values again changes nothing, so it leaves no row.
    assert client.patch(f"/api/samples/{sample_id}", json=edit).status_code == 200
    assert len(_audit(client, action="update_sample")) == 1


def test_cancel_and_notes_record_what_changed(client):
    sample_id = _import(client)["samples"][0]["id"]
    client.patch(f"/api/samples/{sample_id}/notes", json={"notes": "  low yield  "})
    client.post(f"/api/samples/{sample_id}/cancel")

    cancel, notes = _audit(client, sample_id=sample_id, action="update_sample_notes,cancel_sample")
    assert cancel["details_json"] == {"status": {"from": "backlog", "to": "cancelled"}}
    assert notes["details_json"] == {"notes": {"from": None, "to": "low yield"}}


def test_import_writes_an_import_samples_row(client):
    batch = _import(client, "sample,barcodes\nA1,bc1\nA2,bc2")
    (row,) = _audit(client, action="import_samples")
    assert row["entity_type"] == "import_batch"
    assert row["entity_id"] == batch["import_batch_id"]
    assert row["details_json"]["imported_count"] == 2


def test_instrument_create_and_update_are_audited(client):
    created = client.post("/api/instruments", json={"serial_number": "99999", "name": "Spare"})
    assert created.status_code == 201, created.text
    inst_id = created.json()["id"]
    client.patch(f"/api/instruments/{inst_id}", json={"name": "Revio 5", "location": "Lab 2"})
    client.patch(f"/api/instruments/{inst_id}", json={"name": "Revio 5"})  # no change, no row

    update, create = _audit(client, entity_type="instrument")
    assert create["action"] == "instrument_create"
    assert create["details_json"]["serial_number"] == "99999"
    assert update["action"] == "instrument_update"
    assert update["details_json"] == {
        "name": {"from": "Spare", "to": "Revio 5"},
        "location": {"from": None, "to": "Lab 2"},
    }
    assert update["links"] == [{"kind": "instrument", "id": inst_id, "label": "Revio 5"}]


def test_cell_use_notes_record_the_text_change(client):
    sample_id = _import(client)["samples"][0]["id"]
    run = _place(client, sample_id)
    stage = run["plates"][0]["stages"][0]
    client.patch(f"/api/cell-uses/{stage['cell_use_id']}/notes", json={"notes": "bubble in well"})

    (row,) = _audit(client, action="update_cell_use_notes")
    assert row["details_json"] == {"notes": {"from": None, "to": "bubble in well"}}
    # A placement links to its sample, run and cell.
    assert [link["kind"] for link in row["links"]] == ["sample", "run", "cell"]
    assert row["links"][0]["label"] == "A1"
    assert row["links"][1] == {"kind": "run", "id": run["run_id"], "label": f"Run #{run['run_id']}"}


def test_related_filters_follow_placements_even_after_removal(client):
    batch = _import(client, "sample,barcodes\nA1,bc1\nA2,bc2")
    a1, a2 = (s["id"] for s in batch["samples"])
    run = _place(client, a1, 0)
    a1_use = run["plates"][0]["stages"][0]
    cell_id = a1_use["cell_id"]
    tray_id = client.get(f"/api/cells/{cell_id}").json()["tray_id"]
    tray_cells = client.get("/api/cells", params={"tray_id": tray_id}).json()["items"]
    sibling = next(c["id"] for c in tray_cells if c["current_well"] == "B01")
    _place(client, a2, 1, {"mode": "existing", "cell_id": sibling})
    assert client.delete(f"/api/cell-uses/{a1_use['cell_use_id']}").status_code == 204

    a1_rows = _audit(client, sample_id=a1)
    # Placed then removed - both rows still show under the sample, though the use is gone.
    assert [r["action"] for r in a1_rows] == ["remove_sample", "place_sample"]
    assert all(r["links"][0] == {"kind": "sample", "id": a1, "label": "A1"} for r in a1_rows)

    run_rows = _audit(client, run_id=run["run_id"])
    assert sorted(r["action"] for r in run_rows) == ["place_sample", "place_sample", "remove_sample"]

    cell_rows = _audit(client, cell_id=cell_id)
    assert {r["action"] for r in cell_rows} == {"place_sample", "remove_sample"}


def test_actors_lists_everyone_who_made_a_change(client):
    _import(client, **{"X-RunNx-Actor": "Bea"})
    _import(client, "sample,barcodes\nB1,bc2", **{"X-RunNx-Actor": "Ade"})
    assert client.get("/api/audit-log/actors").json() == ["Ade", "Bea"]
