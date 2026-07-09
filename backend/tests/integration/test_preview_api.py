from datetime import date


def default_settings() -> dict:
    return {
        "instrument_ids": ["84047", "84098"],
        "max_uses": 3,
        "run_time_hours": 24,
        "objective": "fewest",
        "start_date": date.today().isoformat(),
    }


def test_preview_matches_golden_fixture_kpis(client, example_samples_text):
    client.post("/api/imports", json={"raw_text": example_samples_text})

    resp = client.post("/api/schedule/preview", json={"settings": default_settings()})
    assert resp.status_code == 200, resp.text
    body = resp.json()

    kpi = body["kpi"]
    assert kpi["total_acq"] == 8
    assert kpi["fresh_cells"] == 3
    assert kpi["prior_cells"] == 0
    assert kpi["nx_cost"] == 5916
    assert kpi["single_cost"] == 7960
    assert kpi["duration_days"] == 4

    assert len(body["cells"]) == 3
    assert body["notes"]["unplaced_sample_ids"] == []
    assert len(body["notes"]["conflict_pairs"]) == 2
    assert "backlog_hash" in body and body["backlog_hash"]

    # preview must NOT persist anything
    backlog = client.get("/api/samples", params={"status": "backlog"}).json()
    assert backlog["total"] == 8
    assert client.get("/api/schedules").json()["total"] == 0


def test_preview_hash_changes_when_backlog_changes(client, example_samples_text):
    client.post("/api/imports", json={"raw_text": example_samples_text})
    first = client.post("/api/schedule/preview", json={"settings": default_settings()}).json()

    client.post("/api/imports", json={"raw_text": "sample,barcodes\nEXTRA-1,bc9999"})
    second = client.post("/api/schedule/preview", json={"settings": default_settings()}).json()

    assert first["backlog_hash"] != second["backlog_hash"]
