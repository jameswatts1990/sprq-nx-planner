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
