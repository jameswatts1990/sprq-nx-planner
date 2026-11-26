"""A run's results from MLWH (GET /api/cycles/{run_id}/sequencing): each well as MLWH recorded it,
matched to the RunNx use it was loaded as, and flagged where the two disagree. MLWH is the SQLite
stand-in (tests/mlwh_fake.py), so the real queries run."""
from datetime import date, datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from app.services import mlwh, mlwh_wells


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


def _import(client, *pools: str) -> None:
    rows = "\n".join(f"{p},bc{i}" for i, p in enumerate(pools))
    assert client.post("/api/imports", json={"raw_text": f"sample,barcodes\n{rows}"}).status_code in (200, 201)


def _sid(client, pool_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["pool_id"] == pool_id)


def _place(client, pool: str, day: date, slot=0, choice=None, hours=24) -> dict:
    resp = client.post("/api/cell-uses", json={
        "sample_id": _sid(client, pool), "instrument_serial": "84047", "load_date": day.isoformat(),
        "slot_index": slot, "cell_choice": choice or {"mode": "new"}, "run_time_hours": hours,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


def _cell_of(run: dict, pool: str) -> int:
    return next(s["cell_id"] for p in run["plates"] for s in p["stages"] if s["sample_pool_id"] == pool)


def _lock(client, run_id: int, name: str | None) -> None:
    body = {"status": "running"} | ({"run_name": name} if name else {})
    assert client.patch(f"/api/cycles/{run_id}", json=body).status_code == 200


def _results(client, run_id: int, **params) -> dict:
    resp = client.get(f"/api/cycles/{run_id}/sequencing", params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _loaded(client, pool="TRAC-2-100", *, day=None, name="TRACTION-RUN-2589", slot=0, hours=24) -> int:
    _import(client, pool)
    run = _place(client, pool, day or _weekday(2), slot=slot, hours=hours)
    _lock(client, run["run_id"], name)
    return run["run_id"]


# --- Availability ---------------------------------------------------------------------------


def test_unknown_run_is_404(client):
    assert client.get("/api/cycles/999/sequencing").status_code == 404


def test_not_configured_is_a_state(client, monkeypatch):
    monkeypatch.setattr(mlwh, "is_configured", lambda: False)
    run_id = _loaded(client)
    body = _results(client, run_id)
    assert body["configured"] is False and body["ok"] is False and body["wells"] == []


def test_an_mlwh_failure_comes_back_as_an_error_message(client, monkeypatch):
    empty = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    monkeypatch.setattr(mlwh, "is_configured", lambda: True)
    monkeypatch.setattr(mlwh_wells, "engine", lambda: empty)
    run_id = _loaded(client)
    body = _results(client, run_id)
    assert body["configured"] is True and body["ok"] is False
    assert "pac_bio_run_well_metrics" in body["error"]


# --- Matching and facts ---------------------------------------------------------------------


def test_a_named_run_shows_each_well_as_mlwh_recorded_it(client, fake_mlwh):
    run_id = _loaded(client, name="traction run 2589")  # typed loosely - still the same run
    fake_mlwh.add_well(state="Passed", movie_minutes=1440, loading_conc=210)
    fake_mlwh.add_well(well="B1", state="Passed")  # nothing in RunNx's B01

    body = _results(client, run_id)
    assert body["ok"] is True and body["matched_by"] == "run_name"
    assert body["mlwh_run_name"] == "TRACTION-RUN-2589"
    assert body["smrt_link_url"] == "https://smrtlink.example.org:8243/sl/runs/11111111-2222"
    a01, b1 = body["wells"]
    assert a01["well"] == "A01" and a01["pool_id"] == "TRAC-2-100" and a01["use_number"] == 1
    facts = a01["mlwh"]
    assert facts["qc_state"] == "Passed" and facts["hifi_yield_gb"] == 12.5 and facts["p1_pct"] == 60.0
    assert facts["loading_conc"] == 210 and facts["hifi_read_length_kb"] == 15.0
    assert facts["library_barcodes"] == ["TRAC-2-100"]
    assert a01["flags"] == []
    assert b1["well"] == "B1" and b1["cell_use_id"] is None
    assert [f["kind"] for f in b1["flags"]] == ["not_in_plan"]


def test_a_use_mlwh_has_not_recorded_yet_has_no_facts(client, fake_mlwh):
    run_id = _loaded(client)
    body = _results(client, run_id)
    assert body["ok"] is True and body["matched_by"] is None and body["smrt_link_url"] is None
    (row,) = body["wells"]
    assert row["mlwh"] is None and row["flags"] == [] and row["key"].startswith("runnx:")


def test_no_verdict_yet_and_an_aborted_run(client, fake_mlwh):
    run_id = _loaded(client)
    fake_mlwh.add_well(state=None, run_status="Aborted", well_status="Aborted")
    facts = _results(client, run_id)["wells"][0]["mlwh"]
    assert facts["qc_state"] is None and facts["run_status"] == "Aborted"


def test_two_plates_with_the_same_well_labels_stay_apart(client, fake_mlwh):
    _import(client, "TRAC-2-100", "TRAC-2-200")
    day = _weekday(2)
    run = _place(client, "TRAC-2-100", day, slot=0)
    _place(client, "TRAC-2-200", day, slot=4)  # a second fresh tray: Plate 2, stored as A02
    _lock(client, run["run_id"], "TRACTION-RUN-2589")
    fake_mlwh.add_well(plate=1, well="A1", libraries=("TRAC-2-100",), state="Passed")
    fake_mlwh.add_well(plate=2, well="A1", libraries=("TRAC-2-200",), state="Passed")

    rows = _results(client, run["run_id"])["wells"]
    assert [(r["plate_number"], r["well"], r["pool_id"]) for r in rows] == [(1, "A01", "TRAC-2-100"), (2, "A02", "TRAC-2-200")]
    assert all(r["flags"] == [] for r in rows)


def test_a_pooled_tube_is_one_row(client, fake_mlwh):
    run_id = _loaded(client, "TRAC-2-300")
    fake_mlwh.add_well(state="Passed", members={"TRAC-2-300": [("S1", 25), ("S2", 25), ("S3", 25), ("S4", 25)]})
    (row,) = _results(client, run_id)["wells"]
    assert row["mlwh"]["library_barcodes"] == ["TRAC-2-300"] and row["mlwh"]["sample_count"] == 4
    assert row["flags"] == []


def test_an_unnamed_run_is_matched_by_instrument_and_load_day(client, fake_mlwh):
    day = _weekday(4)
    run_id = _loaded(client, day=day, name=None)
    fake_mlwh.add_well(run="TRACTION-RUN-9", start=datetime.combine(day + timedelta(days=1), datetime.min.time()))
    body = _results(client, run_id)
    assert body["matched_by"] == "instrument_date" and body["mlwh_run_name"] == "TRACTION-RUN-9"
    assert body["wells"][0]["mlwh"] is not None


# --- Flags ----------------------------------------------------------------------------------


def test_the_wrong_pool_a_different_movie_and_use_are_flagged(client, fake_mlwh):
    run_id = _loaded(client, hours=24)
    fake_mlwh.add_well(libraries=("TRAC-2-999",), movie_minutes=1800, cell_use_count=2, state="Passed")
    flags = {f["kind"]: f for f in _results(client, run_id)["wells"][0]["flags"]}
    assert set(flags) == {"pool_differs", "movie_differs", "use_differs"}
    assert "TRAC-2-999" in flags["pool_differs"]["detail"]
    assert flags["movie_differs"]["detail"] == "Planned 24 h; SMRT Link ran 30 h."
    assert "Use 1" in flags["use_differs"]["detail"] and "Use 2" in flags["use_differs"]["detail"]


def test_a_movie_within_half_an_hour_is_not_flagged(client, fake_mlwh):
    run_id = _loaded(client, hours=24)
    fake_mlwh.add_well(movie_minutes=1440 + 20, state="Passed")
    assert _results(client, run_id)["wells"][0]["flags"] == []


def test_one_runnx_cell_read_as_two_smrt_cells_is_flagged(client, fake_mlwh):
    _import(client, "TRAC-2-100", "TRAC-2-200")
    day1 = _weekday(6)
    day2 = _next_weekday(day1)
    run1 = _place(client, "TRAC-2-100", day1)
    cell = _cell_of(run1, "TRAC-2-100")
    run2 = _place(client, "TRAC-2-200", day2, choice={"mode": "existing", "cell_id": cell})
    _lock(client, run1["run_id"], "TRACTION-RUN-1")
    _lock(client, run2["run_id"], "TRACTION-RUN-2")
    fake_mlwh.add_well(run="TRACTION-RUN-1", libraries=("TRAC-2-100",), cell_id="EA1", cell_use_count=1, state="Passed")
    fake_mlwh.add_well(run="TRACTION-RUN-2", libraries=("TRAC-2-200",), cell_id="EA2", cell_use_count=2, state="Passed")

    (row,) = _results(client, run2["run_id"])["wells"]
    assert row["use_number"] == 2
    (flag,) = row["flags"]
    assert flag["kind"] == "cell_differs" and "EA1" in flag["detail"] and "EA2" in flag["detail"]


def test_the_same_smrt_cell_on_both_uses_is_not_flagged(client, fake_mlwh):
    _import(client, "TRAC-2-100", "TRAC-2-200")
    day1 = _weekday(6)
    run1 = _place(client, "TRAC-2-100", day1)
    cell = _cell_of(run1, "TRAC-2-100")
    run2 = _place(client, "TRAC-2-200", _next_weekday(day1), choice={"mode": "existing", "cell_id": cell})
    _lock(client, run1["run_id"], "TRACTION-RUN-1")
    _lock(client, run2["run_id"], "TRACTION-RUN-2")
    fake_mlwh.add_well(run="TRACTION-RUN-1", libraries=("TRAC-2-100",), cell_id="EA1", cell_use_count=1, state="Passed")
    fake_mlwh.add_well(run="TRACTION-RUN-2", libraries=("TRAC-2-200",), cell_id="EA1", cell_use_count=2, state="Passed")
    assert _results(client, run2["run_id"])["wells"][0]["flags"] == []


# --- Cache ----------------------------------------------------------------------------------


def test_results_are_cached_and_refresh_asks_again(client, fake_mlwh):
    run_id = _loaded(client)
    assert _results(client, run_id)["matched_by"] is None
    fake_mlwh.add_well(state="Passed")
    assert _results(client, run_id)["matched_by"] is None  # still the cached answer
    assert _results(client, run_id, refresh="true")["matched_by"] == "run_name"
