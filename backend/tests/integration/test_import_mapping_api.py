from app.engine.import_fields import IMPORTABLE_FIELDS


def test_create_sample_lands_in_backlog(client):
    resp = client.post(
        "/api/samples",
        json={"external_id": "TRAC-2-30001", "barcodes": ["bc2001", "bc2002"], "priority": "High"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["external_id"] == "TRAC-2-30001"
    assert body["status"] == "backlog"
    assert body["barcodes"] == ["bc2001", "bc2002"]

    backlog = client.get("/api/samples", params={"status": "backlog"}).json()
    assert "TRAC-2-30001" in {s["external_id"] for s in backlog["items"]}


def test_create_sample_barcodes_split_from_free_text_and_deduped(client):
    resp = client.post("/api/samples", json={"external_id": "TRAC-2-30002", "barcodes": ["bc1 bc2, bc1"]})
    assert resp.status_code == 201, resp.text
    assert resp.json()["barcodes"] == ["bc1", "bc2"]


def test_create_sample_duplicate_active_id_is_409(client):
    client.post("/api/samples", json={"external_id": "TRAC-2-30003", "barcodes": ["bc1"]})
    dup = client.post("/api/samples", json={"external_id": "TRAC-2-30003", "barcodes": ["bc9"]})
    assert dup.status_code == 409
    assert "already active" in dup.json()["detail"].lower()


def test_fields_and_template_endpoints(client):
    fields = client.get("/api/imports/fields").json()
    keys = {f["key"] for f in fields}
    assert {"external_id", "barcodes"} <= keys
    assert any(f["required"] for f in fields if f["key"] == "external_id")

    tmpl = client.get("/api/imports/template.csv")
    assert tmpl.status_code == 200
    assert tmpl.headers["content-type"].startswith("text/csv")
    first_line = tmpl.text.splitlines()[0]
    assert first_line.split(",")[0] == IMPORTABLE_FIELDS[0].label  # "Traction / External ID"


def test_preview_suggests_mapping_without_committing(client):
    raw = "Container,Sanger Sample IDs,Barcodes\nTRAC-2-40001,DTOL1,bc1 bc2\nTRAC-2-40002,DTOL2,bc3"
    prev = client.post("/api/imports/preview", json={"raw_text": raw}).json()
    assert prev["has_header"] is True
    assert prev["row_count"] == 2
    assert [c["name"] for c in prev["columns"]] == ["Container", "Sanger Sample IDs", "Barcodes"]
    assert prev["suggested_map"]["external_id"] == 0
    assert prev["suggested_map"]["barcodes"] == 2
    assert prev["unmatched_required"] == []
    # nothing was written
    assert client.get("/api/samples", params={"status": "backlog"}).json()["total"] == 0


def test_commit_with_column_map_imports_renamed_headers_and_reports_skipped(client):
    # Headers the fuzzy matcher would never recognize; the user maps them explicitly.
    raw = "Widget,Codes,Note\nTRAC-2-50001,bc1 bc2,x\nTRAC-2-50002,,y"
    resp = client.post(
        "/api/imports",
        json={"raw_text": raw, "has_header": True, "column_map": {"external_id": 0, "barcodes": 1}},
    ).json()

    assert resp["imported_count"] == 1
    assert resp["skipped_count"] == 1
    assert resp["skipped"] == [{"identifier": "TRAC-2-50002", "reason": "No barcodes"}]
    assert {s["external_id"] for s in resp["samples"]} == {"TRAC-2-50001"}


def test_commit_with_column_map_no_header_treats_row_zero_as_data(client):
    raw = "TRAC-2-60001,bc1\nTRAC-2-60002,bc2"
    resp = client.post(
        "/api/imports",
        json={"raw_text": raw, "has_header": False, "column_map": {"external_id": 0, "barcodes": 1}},
    ).json()
    assert resp["imported_count"] == 2
    assert {s["external_id"] for s in resp["samples"]} == {"TRAC-2-60001", "TRAC-2-60002"}
