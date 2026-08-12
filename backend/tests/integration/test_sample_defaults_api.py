"""GET/PUT /api/settings/sample-defaults and the way those defaults are applied to newly
created / imported samples."""


def _import(client, raw_text: str) -> None:
    resp = client.post("/api/imports", json={"raw_text": raw_text})
    assert resp.status_code == 200, resp.text


def test_defaults_start_at_the_built_in_fallbacks(client):
    resp = client.get("/api/settings/sample-defaults")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "adaptive_loading": "True",
        "full_resolution_base_q": "False",
        "base_kinetics": "False",
        "priority": "Standard (3)",
    }


def test_update_defaults_coerces_and_persists(client):
    resp = client.put(
        "/api/settings/sample-defaults",
        json={"adaptive_loading": "no", "priority": "high"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["adaptive_loading"] == "False"  # "no" -> canonical False
    assert body["priority"] == "High (1)"  # "high" -> canonical label
    # The untouched fields keep their fallbacks, and the change persists across reads.
    assert body["base_kinetics"] == "False"
    assert client.get("/api/settings/sample-defaults").json()["adaptive_loading"] == "False"


def test_update_defaults_rejects_a_bad_priority(client):
    resp = client.put("/api/settings/sample-defaults", json={"priority": "sometime soon"})
    assert resp.status_code == 422


def test_created_sample_fills_blanks_from_defaults_but_respects_explicit_values(client):
    client.put(
        "/api/settings/sample-defaults",
        json={"adaptive_loading": "True", "base_kinetics": "True", "priority": "Medium (2)"},
    )

    # Manual create with nothing specified -> every defaultable field is filled.
    filled = client.post("/api/samples", json={"pool_id": "D1", "barcodes": ["bc1"]})
    assert filled.status_code == 201, filled.text
    b = filled.json()
    assert b["adaptive_loading"] == "True"
    assert b["base_kinetics"] == "True"
    assert b["priority"] == "Medium (2)"

    # An explicit value (including an explicit False) always wins over the default.
    explicit = client.post(
        "/api/samples",
        json={"pool_id": "D2", "barcodes": ["bc2"], "base_kinetics": "False", "priority": "High (1)"},
    )
    assert explicit.status_code == 201, explicit.text
    b2 = explicit.json()
    assert b2["base_kinetics"] == "False"
    assert b2["priority"] == "High (1)"
    assert b2["adaptive_loading"] == "True"  # unspecified -> default


def test_import_backfills_blank_loading_options_from_defaults(client):
    client.put("/api/settings/sample-defaults", json={"adaptive_loading": "True", "priority": "High (1)"})
    _import(client, "sample,barcodes\nIMP1,bc1")
    items = client.get("/api/samples", params={"page_size": 50}).json()["items"]
    imp = next(s for s in items if s["pool_id"] == "IMP1")
    assert imp["adaptive_loading"] == "True"
    assert imp["priority"] == "High (1)"
