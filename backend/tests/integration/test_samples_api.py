"""GET /api/samples: pagination validation (reused from the shared `pagination`
dependency), the priority filter/search, and GET /api/samples/priorities."""


def _import(client, raw_text: str) -> None:
    resp = client.post("/api/imports", json={"raw_text": raw_text})
    assert resp.status_code == 200, resp.text


def test_page_size_validation_rejects_out_of_range_values(client):
    _import(client, "sample,barcodes\nA1,bc1")

    assert client.get("/api/samples", params={"page_size": 0}).status_code == 422
    assert client.get("/api/samples", params={"page_size": 201}).status_code == 422
    assert client.get("/api/samples", params={"page": 0}).status_code == 422
    # the existing default (50) and the reused dependency's own max (200) still work
    assert client.get("/api/samples", params={"page_size": 50}).status_code == 200
    assert client.get("/api/samples", params={"page_size": 200}).status_code == 200


def test_list_priorities_returns_distinct_values_in_rank_order(client):
    _import(
        client,
        "sample,barcodes,priority\nA1,bc1,Standard (3)\nA2,bc2,High (1)\nA3,bc3,High (1)\nA4,bc4,",
    )

    resp = client.get("/api/samples/priorities")
    assert resp.status_code == 200, resp.text
    # deduped, and ordered by rank (High (1) before Standard (3)) rather than alphabetically
    assert resp.json() == ["High (1)", "Standard (3)"]


def test_priority_filter_narrows_results(client):
    _import(
        client,
        "sample,barcodes,priority\nA1,bc1,High (1)\nA2,bc2,Standard (3)\nA3,bc3,High (1)",
    )

    resp = client.get("/api/samples", params={"priority": "High (1)"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 2
    assert {s["external_id"] for s in body["items"]} == {"A1", "A3"}


def test_search_matches_on_priority(client):
    _import(
        client,
        "sample,barcodes,priority\nA1,bc1,High (1)\nA2,bc2,Standard (3)",
    )

    resp = client.get("/api/samples", params={"q": "High"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["external_id"] == "A1"


def test_sort_by_priority_orders_by_rank_not_object_identity(client):
    _import(
        client,
        "sample,barcodes,priority\nA1,bc1,Standard (3)\nA2,bc2,High (1)\nA3,bc3,",
    )

    resp = client.get("/api/samples", params={"sort_by": "priority", "sort_dir": "asc"})
    assert resp.status_code == 200, resp.text
    assert [s["external_id"] for s in resp.json()["items"]] == ["A2", "A1", "A3"]

    resp = client.get("/api/samples", params={"sort_by": "priority", "sort_dir": "desc"})
    assert resp.status_code == 200, resp.text
    assert [s["external_id"] for s in resp.json()["items"]] == ["A3", "A1", "A2"]


# PATCH /api/samples/{id}: manual edit of a backlog sample.


def _create(client, **body):
    body.setdefault("external_id", "TRAC-2-40001")
    body.setdefault("barcodes", ["bc1"])
    resp = client.post("/api/samples", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_update_backlog_sample_edits_fields_and_replaces_barcodes(client):
    created = _create(client, barcodes=["bc1", "bc2"], priority="Standard (3)")

    resp = client.patch(
        f"/api/samples/{created['id']}",
        json={
            "barcodes": ["bc2 bc3, bc3"],  # free-text split + de-dupe, drops bc1
            "priority": "High (1)",
            "target_oplc": 250,
            "adaptive_loading": "true",  # normalized to "True"
            "sanger_ids": ["DTOL1"],
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["barcodes"] == ["bc2", "bc3"]
    assert body["priority"] == "High (1)"
    assert body["target_oplc"] == 250
    assert body["adaptive_loading"] == "True"
    assert body["sanger_ids"] == ["DTOL1"]
    assert body["status"] == "backlog"


def test_update_keeps_a_reused_barcode_without_unique_constraint_error(client):
    """Re-submitting an unchanged barcode must not trip uq_sample_barcode: the old rows
    are deleted before the new ones are inserted."""
    created = _create(client, barcodes=["bc1", "bc2"])
    resp = client.patch(f"/api/samples/{created['id']}", json={"barcodes": ["bc1", "bc9"]})
    assert resp.status_code == 200, resp.text
    assert resp.json()["barcodes"] == ["bc1", "bc9"]


def test_update_cannot_change_container_id(client):
    """external_id isn't part of the update schema; sending it is ignored, not applied."""
    created = _create(client, external_id="TRAC-2-40010", barcodes=["bc1"])
    resp = client.patch(
        f"/api/samples/{created['id']}",
        json={"external_id": "TRAC-2-99999", "barcodes": ["bc1"]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["external_id"] == "TRAC-2-40010"


def test_update_requires_at_least_one_barcode(client):
    created = _create(client, barcodes=["bc1"])
    # A blank barcode reduces to an empty set once split -> 422.
    resp = client.patch(f"/api/samples/{created['id']}", json={"barcodes": ["   "]})
    assert resp.status_code == 422


def test_update_missing_sample_is_404(client):
    resp = client.patch("/api/samples/999999", json={"barcodes": ["bc1"]})
    assert resp.status_code == 404


def test_update_non_backlog_sample_is_409(client):
    created = _create(client, barcodes=["bc1"])
    assert client.post(f"/api/samples/{created['id']}/cancel").status_code == 200
    resp = client.patch(f"/api/samples/{created['id']}", json={"barcodes": ["bc1"]})
    assert resp.status_code == 409
    assert "backlog" in resp.json()["detail"].lower()
