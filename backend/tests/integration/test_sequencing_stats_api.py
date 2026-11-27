"""The Stats reuse tiles (GET /api/stats/sequencing): HiFi yield and P1 by Use 1/2/3 from MLWH, for
the runs loading in range that carry a Traction run name. MLWH is the SQLite stand-in."""
from datetime import date, timedelta

from app.services import mlwh


def _weekday(days_back: int) -> date:
    d = date.today() - timedelta(days=days_back)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def _next_weekday(d: date) -> date:
    d += timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def _sid(client, pool_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["pool_id"] == pool_id)


def _place(client, pool, day, choice=None) -> dict:
    resp = client.post("/api/cell-uses", json={
        "sample_id": _sid(client, pool), "instrument_serial": "84047", "load_date": day.isoformat(),
        "slot_index": 0, "cell_choice": choice or {"mode": "new"}, "run_time_hours": 24,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


def _lock(client, run_id, name=None):
    body = {"status": "running"} | ({"run_name": name} if name else {})
    assert client.patch(f"/api/cycles/{run_id}", json=body).status_code == 200


def _stats(client, **params) -> dict:
    resp = client.get("/api/stats/sequencing", params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_not_configured_is_a_state(client, monkeypatch):
    monkeypatch.setattr(mlwh, "is_configured", lambda: False)
    assert _stats(client)["configured"] is False


def test_yield_and_p1_by_runnx_use_number(client, fake_mlwh):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nTRAC-2-1,bc1\nTRAC-2-2,bc2\nTRAC-2-3,bc3"})
    day1 = _weekday(8)
    day2 = _next_weekday(day1)
    run1 = _place(client, "TRAC-2-1", day1)
    cell = next(s["cell_id"] for p in run1["plates"] for s in p["stages"])
    run2 = _place(client, "TRAC-2-2", day2, {"mode": "existing", "cell_id": cell})
    run3 = _place(client, "TRAC-2-3", _next_weekday(day2))  # no Traction name: can't be matched
    _lock(client, run1["run_id"], "TRACTION-RUN-1")
    _lock(client, run2["run_id"], "TRACTION-RUN-2")
    fake_mlwh.add_well(run="TRACTION-RUN-1", state="Passed", hifi_read_bases=90e9, p0_num=30, p1_num=66, p2_num=4)
    fake_mlwh.add_well(run="TRACTION-RUN-2", state="Passed", hifi_read_bases=80e9, p0_num=40, p1_num=57, p2_num=3)
    # A second cell on run 1 whose run SMRT Link aborted - says nothing about reuse.
    fake_mlwh.add_well(run="TRACTION-RUN-1", well="B1", hifi_read_bases=1e9, run_status="Aborted")

    body = _stats(client, date_from=day1.isoformat())
    assert body["ok"] is True and body["runs_total"] == 3 and body["runs_named"] == 2
    by_use = {u["use"]: u for u in body["by_use"]}
    assert by_use[1] == {"use": 1, "cells": 1, "median_hifi_gb": 90.0, "median_p1_pct": 66.0}
    assert by_use[2] == {"use": 2, "cells": 1, "median_hifi_gb": 80.0, "median_p1_pct": 57.0}
    assert by_use[3]["cells"] == 0 and by_use[3]["median_hifi_gb"] is None
    assert run3["run_id"]  # in range, counted in runs_total, not matched


def test_the_range_and_instrument_filter_apply(client, fake_mlwh):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nTRAC-2-1,bc1"})
    day = _weekday(8)
    run = _place(client, "TRAC-2-1", day)
    _lock(client, run["run_id"], "TRACTION-RUN-1")
    fake_mlwh.add_well(run="TRACTION-RUN-1", state="Passed")
    assert _stats(client, date_from=_next_weekday(day).isoformat())["runs_total"] == 0
    assert _stats(client, instrument_serial="84098")["runs_total"] == 0
    assert _stats(client, instrument_serial="84047")["by_use"][0]["cells"] == 1
