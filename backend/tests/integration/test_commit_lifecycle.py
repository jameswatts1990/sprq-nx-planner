from datetime import date


def default_settings() -> dict:
    return {
        "instrument_ids": ["84047", "84098"],
        "max_uses": 3,
        "run_time_hours": 24,
        "objective": "fewest",
        "start_date": date.today().isoformat(),
    }


def test_commit_persists_schedule_and_flips_samples_to_scheduled(client, example_samples_text):
    client.post("/api/imports", json={"raw_text": example_samples_text})
    preview = client.post("/api/schedule/preview", json={"settings": default_settings()}).json()

    commit_resp = client.post(
        "/api/schedule/commit",
        json={
            "settings": default_settings(),
            "expected_backlog_hash": preview["backlog_hash"],
            "actor": "tester",
        },
    )
    assert commit_resp.status_code == 201, commit_resp.text
    schedule = commit_resp.json()
    assert schedule["status"] == "active"
    assert schedule["kpi"]["total_acq"] == 8

    backlog = client.get("/api/samples", params={"status": "backlog"}).json()
    assert backlog["total"] == 0
    scheduled = client.get("/api/samples", params={"status": "scheduled"}).json()
    assert scheduled["total"] == 8

    detail = client.get(f"/api/schedules/{schedule['id']}").json()
    assert len(detail["cycles"]) == 6  # 3 cycles/machine * 2 machines, per the hand-traced fixture
    total_stages = sum(len(c["stages"]) for c in detail["cycles"])
    assert total_stages == 8

    cells = client.get("/api/cells").json()
    assert cells["total"] == 3
    for cell in cells["items"]:
        assert cell["status"] == "open"  # none exhausted yet - nothing has actually run


def test_commit_rejects_stale_backlog_hash(client, example_samples_text):
    client.post("/api/imports", json={"raw_text": example_samples_text})
    preview = client.post("/api/schedule/preview", json={"settings": default_settings()}).json()

    # backlog changes after the preview was taken
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nEXTRA-1,bc9999"})

    commit_resp = client.post(
        "/api/schedule/commit",
        json={"settings": default_settings(), "expected_backlog_hash": preview["backlog_hash"]},
    )
    assert commit_resp.status_code == 409


def test_cancel_uncommenced_schedule_reverts_samples_to_backlog(client, example_samples_text):
    client.post("/api/imports", json={"raw_text": example_samples_text})
    preview = client.post("/api/schedule/preview", json={"settings": default_settings()}).json()
    schedule = client.post(
        "/api/schedule/commit",
        json={"settings": default_settings(), "expected_backlog_hash": preview["backlog_hash"]},
    ).json()

    cancel = client.post(f"/api/schedules/{schedule['id']}/cancel")
    assert cancel.status_code == 200
    assert cancel.json()["status"] == "cancelled"

    backlog = client.get("/api/samples", params={"status": "backlog"}).json()
    assert backlog["total"] == 8
