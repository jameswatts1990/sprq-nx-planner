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


def test_sort_by_priority_groups_equal_rank_by_container_id(client):
    # Two rank-1 samples separated in import order by another rank-1 sample. They must
    # group by Container ID within the shared rank (the scheduler's own processing order),
    # not stay scattered by import/created order.
    _import(
        client,
        "sample,barcodes,priority\nB1,bc1,High (1)\nA1,bc2,Urgent (1)\nC1,bc3,High (1)",
    )

    resp = client.get("/api/samples", params={"sort_by": "priority", "sort_dir": "asc"})
    assert resp.status_code == 200, resp.text
    # all rank 1, so ordered by Container ID (A1, B1, C1) - not import order (B1, A1, C1)
    assert [s["external_id"] for s in resp.json()["items"]] == ["A1", "B1", "C1"]


def test_sort_by_numeric_column_orders_numerically_with_blanks_last(client):
    # target_oplc is a nullable number; blanks (A3) must stay at the end in BOTH directions
    # rather than floating to the top when the direction flips.
    _create(client, external_id="A1", barcodes=["bc1"], target_oplc=250)
    _create(client, external_id="A2", barcodes=["bc2"], target_oplc=90)
    _create(client, external_id="A3", barcodes=["bc3"])

    asc = client.get("/api/samples", params={"sort_by": "target_oplc", "sort_dir": "asc"})
    assert asc.status_code == 200, asc.text
    assert [s["external_id"] for s in asc.json()["items"]] == ["A2", "A1", "A3"]

    desc = client.get("/api/samples", params={"sort_by": "target_oplc", "sort_dir": "desc"})
    assert desc.status_code == 200, desc.text
    assert [s["external_id"] for s in desc.json()["items"]] == ["A1", "A2", "A3"]


def test_sort_by_text_column_is_case_insensitive(client):
    _create(client, external_id="A1", barcodes=["bc1"], parent_sample="zebra")
    _create(client, external_id="A2", barcodes=["bc2"], parent_sample="Apple")
    _create(client, external_id="A3", barcodes=["bc3"], parent_sample="mango")

    resp = client.get("/api/samples", params={"sort_by": "parent_sample", "sort_dir": "asc"})
    assert resp.status_code == 200, resp.text
    assert [s["external_id"] for s in resp.json()["items"]] == ["A2", "A3", "A1"]


def test_sort_by_unknown_field_is_400(client):
    _import(client, "sample,barcodes\nA1,bc1")
    resp = client.get("/api/samples", params={"sort_by": "not_a_column"})
    assert resp.status_code == 400


def test_list_priorities_scopes_to_status(client):
    _import(
        client,
        "sample,barcodes,priority\nA1,bc1,High (1)\nA2,bc2,Rush (0)",
    )
    # Cancel the "Rush (0)" sample so that priority now lives only on a non-backlog sample.
    items = client.get("/api/samples", params={"status": "backlog"}).json()["items"]
    rush = next(s for s in items if s["priority"] == "Rush (0)")
    assert client.post(f"/api/samples/{rush['id']}/cancel").status_code == 200

    # Unscoped still reports every priority ever used (rank order: 0 before 1).
    assert client.get("/api/samples/priorities").json() == ["Rush (0)", "High (1)"]
    # Backlog-scoped (what the filter dropdown uses) drops the cancelled-only priority,
    # so the dropdown never offers a value that returns zero backlog rows.
    assert client.get("/api/samples/priorities", params={"status": "backlog"}).json() == ["High (1)"]


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


def test_create_and_update_loading_dilution_volumes(client):
    """The three batch-sheet loading-dilution volumes are settable on manual create and
    editable afterwards, and round-trip through SampleOut (they pre-fill the batch sheet)."""
    created = _create(
        client,
        barcodes=["bc1"],
        cleaned_complex_volume=8,
        loading_buffer_volume=6,
        control_dilution_3_volume=2,
    )
    assert created["cleaned_complex_volume"] == 8
    assert created["loading_buffer_volume"] == 6
    assert created["control_dilution_3_volume"] == 2

    resp = client.patch(
        f"/api/samples/{created['id']}",
        json={
            "barcodes": ["bc1"],
            "cleaned_complex_volume": 10,
            "loading_buffer_volume": 5,
            "control_dilution_3_volume": None,  # clearing one back to blank
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["cleaned_complex_volume"] == 10
    assert body["loading_buffer_volume"] == 5
    assert body["control_dilution_3_volume"] is None


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


def test_update_terminal_sample_is_409(client):
    """A finished sample (here: cancelled) is read-only history - editing is refused."""
    created = _create(client, barcodes=["bc1"])
    assert client.post(f"/api/samples/{created['id']}/cancel").status_code == 200
    resp = client.patch(f"/api/samples/{created['id']}", json={"barcodes": ["bc1"]})
    assert resp.status_code == 409
    assert "cancelled" in resp.json()["detail"].lower()


def _next_monday_iso() -> str:
    from datetime import date, timedelta

    d = date.today() + timedelta(days=1)
    while d.weekday() != 0:
        d += timedelta(days=1)
    return d.isoformat()


def test_update_scheduled_sample_edits_loading_params_but_freezes_barcodes(client):
    """A placed (scheduled) sample stays editable, but only its loading/annotation
    parameters. Its barcodes and parent are frozen at placement (barcodes are burned onto
    the cell use), so those fields in the request are ignored rather than applied."""
    created = _create(
        client, external_id="TRAC-2-40100", barcodes=["bc1", "bc2"], parent_sample="P1"
    )
    place = client.post(
        "/api/cell-uses",
        json={
            "sample_id": created["id"],
            "instrument_serial": "84047",
            "load_date": _next_monday_iso(),
            "slot_index": 0,
            "run_time_hours": 24,
        },
    )
    assert place.status_code in (200, 201), place.text
    assert client.get(f"/api/samples/{created['id']}").json()["status"] == "scheduled"

    resp = client.patch(
        f"/api/samples/{created['id']}",
        json={
            "barcodes": ["bcX"],  # frozen once placed -> ignored
            "parent_sample": "P-CHANGED",  # frozen -> ignored
            "priority": "High (1)",  # editable
            "target_oplc": 275,  # editable
            "adaptive_loading": "true",  # editable, normalized to "True"
            "cleaned_complex_volume": 9,  # editable (feeds the batch sheet)
            "loading_buffer_volume": 4,  # editable
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "scheduled"
    assert body["priority"] == "High (1)"
    assert body["target_oplc"] == 275
    assert body["adaptive_loading"] == "True"
    assert body["cleaned_complex_volume"] == 9
    assert body["loading_buffer_volume"] == 4
    # Frozen fields are left exactly as placed.
    assert body["barcodes"] == ["bc1", "bc2"]
    assert body["parent_sample"] == "P1"
