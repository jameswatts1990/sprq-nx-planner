def test_import_example_csv_lands_in_backlog(client, example_samples_text):
    resp = client.post("/api/imports", json={"raw_text": example_samples_text, "actor": "tester"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["imported_count"] == 8
    assert body["duplicate_count"] == 0
    assert body["skipped_count"] == 0
    assert len(body["samples"]) == 8
    assert {s["status"] for s in body["samples"]} == {"backlog"}

    backlog = client.get("/api/samples", params={"status": "backlog"}).json()
    assert backlog["total"] == 8
    assert {s["external_id"] for s in backlog["items"]} == {
        "BNCH-1597",
        "BNCH-1598",
        "BNCH-1599",
        "BNCH-1600",
        "BNCH-1601",
        "BNCH-1602",
        "BNCH-1603",
        "BNCH-1604",
    }


def test_reimporting_same_rows_is_flagged_as_duplicate_and_not_double_counted(client, example_samples_text):
    first = client.post("/api/imports", json={"raw_text": example_samples_text})
    assert first.json()["imported_count"] == 8

    second = client.post("/api/imports", json={"raw_text": example_samples_text})
    body = second.json()
    assert body["imported_count"] == 0
    assert body["duplicate_count"] == 8
    assert len(body["rejected"]) == 8

    backlog = client.get("/api/samples", params={"status": "backlog"}).json()
    assert backlog["total"] == 8  # still just the original 8, not 16


def test_reimport_is_allowed_once_prior_attempt_is_cancelled(client):
    text = "sample,barcodes\nA,bc1"
    first = client.post("/api/imports", json={"raw_text": text}).json()
    sample_id = first["samples"][0]["id"]

    cancel = client.post(f"/api/samples/{sample_id}/cancel")
    assert cancel.status_code == 200

    second = client.post("/api/imports", json={"raw_text": text}).json()
    assert second["imported_count"] == 1
    assert second["duplicate_count"] == 0


def test_row_without_barcodes_is_skipped_and_reported_in_warnings(client):
    text = "sample,barcodes\nA,bc1\nB,\nC,bc3"
    resp = client.post("/api/imports", json={"raw_text": text}).json()
    assert resp["imported_count"] == 2
    assert resp["skipped_count"] == 1
    assert any("B" in w for w in resp["warnings"])
