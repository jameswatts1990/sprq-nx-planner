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
    assert {s["pool_id"] for s in backlog["items"]} == {
        "BNCH-1597",
        "BNCH-1598",
        "BNCH-1599",
        "BNCH-1600",
        "BNCH-1601",
        "BNCH-1602",
        "BNCH-1603",
        "BNCH-1604",
    }


def test_reimporting_same_rows_creates_copies_and_flags_them_as_duplicates(client, example_samples_text):
    """Duplicates are a supported workflow (same sample across multiple cells), so a re-import
    now CREATES the copies rather than rejecting them - and flags each so the user can Undo if
    it wasn't intended."""
    first = client.post("/api/imports", json={"raw_text": example_samples_text})
    assert first.json()["imported_count"] == 8

    second = client.post("/api/imports", json={"raw_text": example_samples_text})
    body = second.json()
    assert body["imported_count"] == 8  # every row imported again as a copy
    assert body["duplicate_count"] == 8  # all 8 flagged as seen-before
    assert body["rejected"] == []  # duplicates are no longer rejected
    # Each Pool ID reports one copy created now, seen twice total (prior + this import).
    by_id = {d["pool_id"]: d for d in body["duplicates"]}
    assert by_id["BNCH-1597"] == {"pool_id": "BNCH-1597", "created_now": 1, "total_seen": 2}

    backlog = client.get("/api/samples", params={"status": "backlog"}).json()
    assert backlog["total"] == 16  # now 16, two copies of each of the 8


def test_within_file_duplicate_creates_multiple_copies_with_ordinal(client):
    text = "sample,barcodes\nA,bc1\nA,bc2\nA,bc3\nB,bc4"
    body = client.post("/api/imports", json={"raw_text": text}).json()
    assert body["imported_count"] == 4
    by_id = {d["pool_id"]: d for d in body["duplicates"]}
    assert by_id["A"] == {"pool_id": "A", "created_now": 3, "total_seen": 3}
    assert "B" not in by_id  # a singleton is never flagged

    backlog = client.get("/api/samples", params={"status": "backlog", "q": "A"}).json()
    a_copies = [s for s in backlog["items"] if s["pool_id"] == "A"]
    assert {s["duplicate_index"] for s in a_copies} == {1, 2, 3}
    assert {s["duplicate_total"] for s in a_copies} == {3}


def test_reimport_after_cancel_still_flags_prior_completed_or_cancelled_copy(client):
    """The 'seen N times' count spans ALL statuses, so a cancelled prior copy still counts."""
    text = "sample,barcodes\nA,bc1"
    first = client.post("/api/imports", json={"raw_text": text}).json()
    sample_id = first["samples"][0]["id"]

    cancel = client.post(f"/api/samples/{sample_id}/cancel")
    assert cancel.status_code == 200

    second = client.post("/api/imports", json={"raw_text": text}).json()
    assert second["imported_count"] == 1
    assert second["duplicate_count"] == 1  # prior cancelled copy is still "seen"
    assert second["duplicates"][0]["total_seen"] == 2


def test_row_without_barcodes_is_skipped_and_reported_in_warnings(client):
    text = "sample,barcodes\nA,bc1\nB,\nC,bc3"
    resp = client.post("/api/imports", json={"raw_text": text}).json()
    assert resp["imported_count"] == 2
    assert resp["skipped_count"] == 1
    assert any("B" in w for w in resp["warnings"])
