"""POST /api/auto-fill: the "auto schedule" assist over a user-selected set of empty
grid cells. Fills only the requested cells, skips ones that filled up in the meantime,
and reports what didn't fit."""
from datetime import date, timedelta

SIX_DISJOINT = "sample,barcodes\n" + "\n".join(f"X{i},bcx{i}" for i in range(1, 7))


def _weekdays(n: int) -> list[str]:
    out: list[str] = []
    d = date.today()
    while len(out) < n:
        d += timedelta(days=1)
        if d.weekday() < 5:
            out.append(d.isoformat())
    return out


def _next_saturday() -> str:
    d = date.today()
    while d.weekday() != 5:
        d += timedelta(days=1)
    return d.isoformat()


def _sid(client, external_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["external_id"] == external_id)


def _auto_fill(client, cells, objective="fastest", run_time_hours=24, max_uses=3):
    return client.post(
        "/api/auto-fill",
        json={"cells": cells, "objective": objective, "run_time_hours": run_time_hours, "max_uses": max_uses},
    )


def test_auto_fill_fills_only_requested_cell_and_reports_unplaced(client):
    client.post("/api/imports", json={"raw_text": SIX_DISJOINT})
    (mon,) = _weekdays(1)

    resp = _auto_fill(client, [{"instrument_serial": "84047", "run_date": mon}])
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # one cell = 4 wells; 6 samples in => 4 placed, 2 unplaced
    assert len(body["placed_sample_ids"]) == 4
    assert len(body["unplaced_sample_ids"]) == 2
    assert body["skipped_cells"] == []
    assert len(body["runs"]) == 1
    run = body["runs"][0]
    assert run["instrument_serial"] == "84047"
    assert run["run_date"] == mon
    assert len(run["stages"]) == 4

    # only the requested instrument got a run
    assert client.get("/api/cycles", params={"instrument_serial": "84098"}).json() == []
    assert client.get("/api/samples", params={"status": "scheduled"}).json()["total"] == 4
    assert client.get("/api/samples", params={"status": "backlog"}).json()["total"] == 2


def test_auto_fill_skips_already_occupied_cell(client):
    client.post("/api/imports", json={"raw_text": SIX_DISJOINT})
    (mon,) = _weekdays(1)

    # pre-occupy (84047, mon) with a manual placement
    pre = client.post(
        "/api/cell-uses",
        json={
            "sample_id": _sid(client, "X1"),
            "instrument_serial": "84047",
            "run_date": mon,
            "slot_index": 0,
            "cell_choice": {"mode": "new"},
            "run_time_hours": 24,
            "max_uses": 3,
        },
    )
    assert pre.status_code == 201, pre.text

    resp = _auto_fill(
        client,
        [{"instrument_serial": "84047", "run_date": mon}, {"instrument_serial": "84098", "run_date": mon}],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # the occupied cell is skipped wholesale; the empty one is filled
    assert body["skipped_cells"] == [{"instrument_serial": "84047", "run_date": mon}]
    assert len(body["runs"]) == 1
    assert body["runs"][0]["instrument_serial"] == "84098"
    # 5 remained in backlog after the manual placement; 4 wells on 84098 => 4 placed, 1 unplaced
    assert len(body["placed_sample_ids"]) == 4
    assert len(body["unplaced_sample_ids"]) == 1


def test_auto_fill_rejects_weekend_cell(client):
    client.post("/api/imports", json={"raw_text": SIX_DISJOINT})
    resp = _auto_fill(client, [{"instrument_serial": "84047", "run_date": _next_saturday()}])
    assert resp.status_code == 400
    assert "weekend" in resp.json()["detail"].lower()
