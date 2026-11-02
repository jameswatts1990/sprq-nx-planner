"""GET /api/cycles/history - the Run history page's paged run rows - and GET /api/samples/history,
the Samples page's rows with each sample's cell uses."""
from datetime import UTC, date, datetime, timedelta


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


def _sid(client, pool_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["pool_id"] == pool_id)


def _place(client, pool_id: str, load_date: str, instrument: str = "84047", slot_index: int = 0) -> dict:
    """Place a sample - Plate 1's first well on a fresh tray, later wells on its siblings - and
    return the run (RunOut)."""
    payload = {
        "sample_id": _sid(client, pool_id),
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


def _history(client, **params) -> dict:
    r = client.get("/api/cycles/history", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_a_row_carries_its_wells_and_a_search_rings_the_well_that_matched(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nPOOLA,bca1\nPOOLB,bcb1"})
    (mon,) = _weekdays(1)
    _place(client, "POOLA", mon, slot_index=0)
    run = _place(client, "POOLB", mon, slot_index=1)

    body = _history(client)
    assert body["total"] == 1
    (row,) = body["items"]
    assert row["run_id"] == run["run_id"]
    assert (row["instrument_serial"], row["load_date"], row["status"]) == ("84047", mon, "planned")
    assert (row["plate_count"], row["movie_hours"], row["loaded"]) == (1, 24, False)
    assert [(w["well"], w["sample_pool_id"], w["use_number"]) for w in row["wells"]] == [
        ("A01", "POOLA", 1),
        ("B01", "POOLB", 1),
    ]
    assert row["matched_use_ids"] == []

    # A Pool ID or a barcode finds the run and rings only the well that carried it.
    (hit,) = _history(client, q="poolb")["items"]
    assert hit["matched_use_ids"] == [row["wells"][1]["cell_use_id"]]
    (hit,) = _history(client, q="bca1")["items"]
    assert hit["matched_use_ids"] == [row["wells"][0]["cell_use_id"]]
    # The run's own "#id" or instrument match the whole run - no well is singled out.
    (hit,) = _history(client, q=f"#{run['run_id']}")["items"]
    assert hit["matched_use_ids"] == []
    assert _history(client, q="84047")["total"] == 1
    assert _history(client, q="NOPE")["total"] == 0


def test_status_filter_matches_each_runs_derived_status(client):
    """The SQL status pre-filter must agree with run_serializer.run_status for every state,
    including a run still marked running whose cells are long through PPA (reads completed)."""
    pools = ["PLAN", "LIVE", "DONE", "STOP", "OLD"]
    client.post("/api/imports", json={"raw_text": "sample,barcodes\n" + "\n".join(f"{p},bc{p}" for p in pools)})
    # One fresh tray each, spread over the instruments so no instrument runs out of tray bays.
    days = _weekdays(len(pools))
    instruments = ["84047", "84098", "84093", "84309", "84047"]
    runs = {p: _place(client, p, d, instrument=i)["run_id"] for p, d, i in zip(pools, days, instruments)}
    now = datetime.now(UTC)
    for pool, steps in {
        "LIVE": [("running", now)],
        "DONE": [("running", now), ("completed", now)],
        "STOP": [("running", now), ("aborted", now)],
        "OLD": [("running", now - timedelta(days=10))],
    }.items():
        for status, at in steps:
            r = client.patch(f"/api/cycles/{runs[pool]}", json={"status": status, "at": at.isoformat()})
            assert r.status_code == 200, r.text

    derived = {r["run_id"]: r["status"] for r in client.get("/api/cycles").json()}
    assert derived[runs["OLD"]] == "completed"
    assert derived[runs["LIVE"]] == "running"
    for status in ("planned", "running", "completed", "aborted"):
        got = sorted(r["run_id"] for r in _history(client, status=status)["items"])
        assert got == sorted(i for i, s in derived.items() if s == status), status
        assert all(r["status"] == status for r in _history(client, status=status)["items"])


def test_history_sorts_and_pages_in_sql(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA,bca\nB,bcb\nC,bcc"})
    mon, tue = _weekdays(2)
    _place(client, "A", mon, instrument="84098")
    _place(client, "B", tue, instrument="84047")
    _place(client, "C", mon, instrument="84047")

    newest_first = [(r["load_date"], r["instrument_serial"]) for r in _history(client)["items"]]
    assert newest_first == [(tue, "84047"), (mon, "84047"), (mon, "84098")]
    by_instrument = _history(client, sort_by="instrument", sort_dir="asc")["items"]
    assert [(r["instrument_serial"], r["load_date"]) for r in by_instrument] == [
        ("84047", tue),
        ("84047", mon),
        ("84098", mon),
    ]
    page2 = _history(client, page=2, page_size=2)
    assert page2["total"] == 3
    assert [(r["load_date"], r["instrument_serial"]) for r in page2["items"]] == [(mon, "84098")]

    assert _history(client, instrument_serial="84098")["total"] == 1
    assert _history(client, date_from=tue)["total"] == 1
    assert _history(client, date_to=mon)["total"] == 2
    assert _history(client, cell_type="sprq")["total"] == 0
    assert _history(client, cell_type="sprq_nx")["total"] == 3

    assert client.get("/api/cycles/history", params={"sort_by": "colour"}).status_code == 400
    assert client.get("/api/cycles/history", params={"sort_dir": "up"}).status_code == 400
    assert client.get("/api/cycles/history", params={"status": "lost"}).status_code == 400


def test_sample_history_lists_every_status_with_each_samples_cell_uses(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nPLACED,bcp\nWAITING,bcw"})
    (mon,) = _weekdays(1)
    run = _place(client, "PLACED", mon, instrument="84098")

    body = client.get("/api/samples/history").json()
    assert body["total"] == 2
    by_pool = {s["pool_id"]: s for s in body["items"]}
    assert by_pool["WAITING"]["status"] == "backlog"
    assert by_pool["WAITING"]["cell_uses"] == []
    (use,) = by_pool["PLACED"]["cell_uses"]
    assert by_pool["PLACED"]["status"] == "scheduled"
    assert (use["run_batch_id"], use["load_date"], use["instrument_serial"], use["plate_number"], use["well"]) == (
        run["run_id"],
        mon,
        "84098",
        1,
        "A01",
    )

    scheduled = client.get("/api/samples/history", params={"status": "scheduled"}).json()
    assert [s["pool_id"] for s in scheduled["items"]] == ["PLACED"]
    assert client.get("/api/samples/history", params={"q": "bcw"}).json()["items"][0]["pool_id"] == "WAITING"
    by_pool_id = client.get("/api/samples/history", params={"sort_by": "pool_id", "sort_dir": "asc"}).json()
    assert [s["pool_id"] for s in by_pool_id["items"]] == ["PLACED", "WAITING"]
