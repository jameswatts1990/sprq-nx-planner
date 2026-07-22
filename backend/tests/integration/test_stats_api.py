"""End-to-end shape + filter behaviour for GET /api/stats. The aggregation math is
covered in tests/unit/test_stats_service.py; here we just confirm the endpoint wires up,
returns the four groups, and honours the date/instrument filters."""
from datetime import date, timedelta


def _past_weekday() -> str:
    d = date.today() - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d.isoformat()


def _sid(client, external_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["external_id"] == external_id)


def test_stats_empty_db_returns_all_groups(client):
    r = client.get("/api/stats")
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"headline", "throughput", "reuse", "failures", "inventory"}
    assert body["headline"]["runs_completed"] == 0
    assert body["throughput"]["series"] == []
    # all four instruments still listed (zeroed), so the per-instrument chart isn't blank
    assert len(body["throughput"]["per_instrument"]) == 4
    assert body["reuse"]["depth_distribution"] == [
        {"uses": 1, "cells": 0},
        {"uses": 2, "cells": 0},
        {"uses": 3, "cells": 0},
    ]


def test_stats_reflects_a_completed_run(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nS1,bc1"})
    past = _past_weekday()
    r1 = client.post(
        "/api/cell-uses",
        json={
            "sample_id": _sid(client, "S1"),
            "instrument_serial": "84047",
            "run_date": past,
            "slot_index": 0,
            "cell_choice": {"mode": "new"},
            "run_time_hours": 24,
            "max_uses": 3,
        },
    )
    assert r1.status_code == 201, r1.text
    cycle_id = r1.json()["cycle_id"]
    assert client.patch(f"/api/cycles/{cycle_id}", json={"status": "running"}).status_code == 200
    assert client.patch(f"/api/cycles/{cycle_id}", json={"status": "completed"}).status_code == 200

    body = client.get("/api/stats").json()
    assert body["headline"]["runs_completed"] == 1
    assert body["headline"]["samples_completed"] == 1
    assert body["throughput"]["series"][0]["runs"] == 1
    assert {o["status"]: o["count"] for o in body["failures"]["outcomes"]}["completed"] == 1

    # instrument filter: nothing on 84098
    other = client.get("/api/stats", params={"instrument_serial": "84098"}).json()
    assert other["headline"]["runs_completed"] == 0

    # date filter: a window entirely after the run excludes it
    future = (date.today() + timedelta(days=30)).isoformat()
    later = client.get("/api/stats", params={"date_from": future}).json()
    assert later["throughput"]["series"] == []
