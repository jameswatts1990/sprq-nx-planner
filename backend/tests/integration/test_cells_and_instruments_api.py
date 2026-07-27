def test_bootstrap_cell_registers_existing_in_progress_cell(client):
    resp = client.post(
        "/api/cells/bootstrap",
        json={"max_uses": 3, "uses_consumed": 2, "burned_barcodes": ["bc2021", "bc2044"], "actor": "ops"},
    )
    assert resp.status_code == 201, resp.text
    cell = resp.json()
    assert cell["uses_consumed"] == 2
    assert cell["uses_remaining"] == 1
    assert cell["burned_barcodes"] == ["bc2021", "bc2044"]
    assert cell["status"] == "open"
    assert len(cell["use_history"]) == 2

    listed = client.get("/api/cells", params={"status": "open"}).json()
    assert cell["id"] in [c["id"] for c in listed["items"]]

    audit = client.get("/api/audit-log", params={"entity_type": "cell", "entity_id": cell["id"]}).json()
    assert any(row["action"] == "bootstrap_cell" for row in audit["items"])


def test_retire_cell_via_qc_and_rejects_a_second_retire(client):
    # Retire is a Cell QC verdict now (POST /api/cells/{id}/qc/*). A fresh cell with no
    # planned uses retires immediately (no samples to dispose).
    from tests.integration._qc_helpers import qc_retire

    resp = client.post("/api/cells/bootstrap", json={"max_uses": 3, "uses_consumed": 0, "burned_barcodes": []})
    cell_id = resp.json()["id"]

    retired = qc_retire(client, cell_id)
    assert retired.status_code == 200, retired.text
    assert retired.json()["cell"]["status"] == "retired"

    # already terminal - a second QC verdict is rejected (409), not a silent no-op
    again = qc_retire(client, cell_id)
    assert again.status_code == 409


def test_instruments_are_seeded_by_fixture_and_listable(client):
    resp = client.get("/api/instruments")
    assert resp.status_code == 200
    serials = {i["serial_number"] for i in resp.json()}
    assert serials == {"84047", "84098", "84093", "84309"}


def test_create_and_update_instrument(client):
    created = client.post("/api/instruments", json={"serial_number": "99999", "name": "Spare Revio"})
    assert created.status_code == 201
    instrument_id = created.json()["id"]

    dup = client.post("/api/instruments", json={"serial_number": "99999"})
    assert dup.status_code == 409

    updated = client.patch(f"/api/instruments/{instrument_id}", json={"active": False})
    assert updated.status_code == 200
    assert updated.json()["active"] is False
