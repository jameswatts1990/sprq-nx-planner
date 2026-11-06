"""GET /api/cycles/search - the Schedule header search, done in SQL instead of the frontend
pulling every run ever (cyclesApi.list({})) and matching in the browser."""
from datetime import date, timedelta

import pytest


def _weekdays(n: int) -> list[str]:
    d = date.today() + timedelta(days=1)
    while d.weekday() != 0:
        d += timedelta(days=1)
    out: list[str] = []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _sample(client, pool_id: str, barcode: str, *, sanger: list[str] | None = None, plate: str | None = None) -> int:
    r = client.post(
        "/api/samples", json={"pool_id": pool_id, "barcodes": [barcode], "sanger_ids": sanger or [], "plate_id": plate}
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _place(client, sample_id: int, load_date: str, slot_index: int, instrument: str = "84047") -> dict:
    payload = {
        "sample_id": sample_id,
        "instrument_serial": instrument,
        "load_date": load_date,
        "slot_index": slot_index,
        "run_time_hours": 24,
    }
    if slot_index == 0:
        payload["cell_choice"] = {"mode": "new"}
    r = client.post("/api/cell-uses", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def _search(client, q: str, **params) -> list[tuple[str, str, int]]:
    r = client.get("/api/cycles/search", params={"q": q, **params})
    assert r.status_code == 200, r.text
    return [(h["load_date"], h["instrument_serial"], h["slot_index"]) for h in r.json()]


def _old_client_search(runs: list[dict], q: str) -> list[tuple[str, str, int]]:
    """A port of the matching useScheduleSearch did in the browser over every RunOut: a run's
    name (or its id, for a "#"-optional all-digits query) hits all its slots; otherwise a slot hits
    on its sample's Pool / Plate / Sanger IDs or barcodes. One deliberate change: the browser
    matched a run id as a substring ("4" hit runs 4, 14, 40...); the endpoint matches it exactly,
    as the Run history search does."""
    ql = q.strip().lower()
    digits = ql.lstrip("#") if ql.lstrip("#").isdigit() else ""
    hits = set()
    for run in runs:
        run_hit = bool(run["run_name"] and ql in run["run_name"].lower()) or bool(digits and digits == str(run["run_id"]))
        for plate in run["plates"]:
            for st in plate["stages"]:
                ids = [st["sample_pool_id"], st["sample_plate_id"], *st["sample_sanger_ids"], *st["barcodes"]]
                if run_hit or any(i is not None and ql in i.lower() for i in ids):
                    hits.add((run["load_date"], run["instrument_serial"], st["slot_index"]))
    return sorted(hits)


@pytest.fixture
def schedule(client):
    """Two weeks of runs on two instruments: a two-sample run with a lab run name, a run whose
    sample carries Sanger/Plate IDs, and a later run reusing an earlier sample's barcode."""
    mon, tue, _wed, _thu, _fri, mon2 = _weekdays(6)
    a = _sample(client, "POOL-ALPHA", "bc1001", plate="PLATE-7")
    b = _sample(client, "POOL-BETA", "bc1002", sanger=["SQPP-555-A"])
    c = _sample(client, "POOL-GAMMA", "bc1003")
    d = _sample(client, "POOL-DELTA", "bc1004")
    named = _place(client, a, mon, 0)
    _place(client, b, mon, 1)
    _place(client, c, tue, 0, instrument="84098")
    _place(client, d, mon2, 0)
    lock = client.patch(f"/api/cycles/{named['run_id']}", json={"status": "running", "run_name": "TRACTION-RUN-77"})
    assert lock.status_code == 200, lock.text
    return {"mon": mon, "tue": tue, "mon2": mon2, "named_run_id": named["run_id"]}


@pytest.mark.parametrize(
    "query",
    ["pool-alpha", "POOL", "plate-7", "sqpp-555", "bc1003", "traction-run", "77", "NO-SUCH-THING", "bc100"],
)
def test_matches_what_the_browser_search_found(client, schedule, query):
    runs = client.get("/api/cycles").json()
    assert _search(client, query) == _old_client_search(runs, query)


def test_run_id_query_hits_every_slot_of_that_run(client, schedule):
    run_id = schedule["named_run_id"]
    runs = client.get("/api/cycles").json()
    assert _search(client, f"#{run_id}") == _old_client_search(runs, f"#{run_id}")
    assert _search(client, f"#{run_id}") == [(schedule["mon"], "84047", 0), (schedule["mon"], "84047", 1)]


def test_finds_matches_outside_any_visible_week_in_grid_order(client, schedule):
    assert _search(client, "pool-") == [
        (schedule["mon"], "84047", 0),
        (schedule["mon"], "84047", 1),
        (schedule["tue"], "84098", 0),
        (schedule["mon2"], "84047", 0),
    ]


def test_also_finds_a_cell_code(client, schedule):
    runs = client.get("/api/cycles").json()
    stage = runs[0]["plates"][0]["stages"][0]
    assert (runs[0]["load_date"], runs[0]["instrument_serial"], stage["slot_index"]) in _search(
        client, stage["cell_ref"]
    )


def test_load_date_and_instrument_do_not_flood_the_results(client, schedule):
    # The Run history search matches these; on the grid they'd ring every slot of a week / machine.
    assert _search(client, "84047") == []
    assert _search(client, schedule["mon"]) == []


def test_limit_keeps_the_latest_hits(client, schedule):
    assert _search(client, "pool-", limit=1) == [(schedule["mon2"], "84047", 0)]
    assert client.get("/api/cycles/search", params={"q": "x", "limit": 201}).status_code == 422


def test_blank_query_returns_nothing(client, schedule):
    assert _search(client, "   ") == []
