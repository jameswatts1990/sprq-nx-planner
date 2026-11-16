"""GET /api/cells/schedule-trays - the Schedule page's tray-panel feed: the same per-cell values
GET /api/cells serializes, scoped to whole trays that can still be on an instrument from date_from
on, in a fixed number of queries however much history there is."""
from datetime import date, timedelta

import pytest
from sqlalchemy import event

FIELDS = (
    "id",
    "code",
    "cell_type",
    "max_uses",
    "status",
    "uses_consumed",
    "uses_remaining",
    "current_instrument_serial",
    "current_well",
    "first_use_started_at",
    "first_use_planned_start_at",
    "tray_id",
    "tray_position",
    "tray_reuse_disabled",
)


def _mondays(n: int) -> list[date]:
    d = date.today() + timedelta(days=1)
    while d.weekday() != 0:
        d += timedelta(days=1)
    return [d + timedelta(weeks=i) for i in range(n)]


def _place(client, pool_id: str, load_date: date, instrument: str = "84047", cell_choice: dict | None = None) -> dict:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    sample_id = next(s["id"] for s in items if s["pool_id"] == pool_id)
    r = client.post(
        "/api/cell-uses",
        json={
            "sample_id": sample_id,
            "instrument_serial": instrument,
            "load_date": load_date.isoformat(),
            "slot_index": 0,
            "cell_choice": cell_choice or {"mode": "new"},
            "run_time_hours": 24,
        },
    )
    assert r.status_code == 201, r.text
    stage = next(s for p in r.json()["plates"] for s in p["stages"] if s["sample_pool_id"] == pool_id)
    return {**stage, "run_id": r.json()["run_id"]}


def _import(client, *pools: str) -> None:
    rows = "\n".join(f"{p},bc{p}" for p in pools)
    r = client.post("/api/imports", json={"raw_text": f"sample,barcodes\n{rows}"})
    assert r.status_code < 300, r.text


def _schedule_trays(client, date_from: date) -> list[dict]:
    r = client.get("/api/cells/schedule-trays", params={"date_from": date_from.isoformat()})
    assert r.status_code == 200, r.text
    return r.json()


def _all_cells(client) -> dict[int, dict]:
    return {c["id"]: c for c in client.get("/api/cells", params={"page_size": 1000}).json()["items"]}


@pytest.fixture
def turnover(client):
    """Tray A takes Monday's use (confirmed loaded) and a reuse on Friday; rotating A from Monday
    moves Friday's use onto a fresh tray B in the same carousel bay - so B is founded on Friday
    and evicts A that day, leaving A's cells spent."""
    mon = _mondays(1)[0]
    fri = mon + timedelta(days=4)
    _import(client, "OLD1", "NEW1")
    old = _place(client, "OLD1", mon)
    r = client.patch(f"/api/cycles/{old['run_id']}", json={"status": "running"})
    assert r.status_code == 200, r.text
    _place(client, "NEW1", fri, cell_choice={"mode": "existing", "cell_id": old["cell_id"]})
    tray_a = _all_cells(client)[old["cell_id"]]["tray_id"]
    r = client.post("/api/cells/rotate-tray", json={"tray_id": tray_a, "from_date": mon.isoformat()})
    assert r.status_code == 200, r.text
    tray_b = r.json()["new_cells"][0]["tray_id"]
    return {"mon": mon, "fri": fri, "tray_a": tray_a, "tray_b": tray_b}


def test_every_field_matches_the_full_cell_serializer(client, turnover):
    full = _all_cells(client)
    rows = _schedule_trays(client, turnover["mon"])
    assert {r["tray_id"] for r in rows} == {turnover["tray_a"], turnover["tray_b"]}
    assert {r["id"] for r in rows} == {c["id"] for c in full.values() if c["tray_id"] is not None}
    assert any(r["first_use_started_at"] for r in rows)  # the confirmed-loaded path is covered
    for row in rows:
        cell = full[row["id"]]
        assert {f: row[f] for f in FIELDS} == {f: cell[f] for f in FIELDS}
        assert row["uses"] == [
            {"status": u["status"], "breakout_anchor_at": u["breakout_anchor_at"]} for u in cell["uses"]
        ]
        if cell["window_hours_elapsed"] is None:
            assert row["window_hours_elapsed"] is None
        else:
            assert row["window_hours_elapsed"] == pytest.approx(cell["window_hours_elapsed"], abs=0.01)


def test_a_tray_evicted_by_date_from_is_left_out(client, turnover):
    tray_a, tray_b = turnover["tray_a"], turnover["tray_b"]
    assert all(c["status"] not in ("open", "stopped") for c in _all_cells(client).values() if c["tray_id"] == tray_a)
    # A window starting before B's founding day: A can still be resident, both are sent.
    assert {r["tray_id"] for r in _schedule_trays(client, turnover["fri"] - timedelta(days=1))} == {tray_a, tray_b}
    # From B's founding day (A's eviction) on, the spent tray A is left out.
    assert {r["tray_id"] for r in _schedule_trays(client, turnover["fri"])} == {tray_b}


def test_date_from_is_required_and_the_path_is_not_a_cell_id(client):
    assert client.get("/api/cells/schedule-trays").status_code == 422
    assert client.get("/api/cells/schedule-trays", params={"date_from": "2026-01-05"}).json() == []


def test_query_count_does_not_grow_with_history(client, db_session):
    """Two column queries, whatever the number of trays/uses - not the full cell graph per cell."""
    mon = _mondays(1)[0]
    instruments = ("84047", "84098", "84093", "84309")
    pools = [f"P{i}" for i in range(12)]
    _import(client, *pools)

    statements: list[str] = []

    def _record(conn, cursor, statement, *args):
        statements.append(statement)

    def _count() -> int:
        statements.clear()
        engine = db_session.get_bind()
        event.listen(engine, "before_cursor_execute", _record)
        try:
            _schedule_trays(client, mon)
        finally:
            event.remove(engine, "before_cursor_execute", _record)
        return len(statements)

    first = _place(client, pools[0], mon)
    small = _count()
    # A fresh tray on every other instrument, then two reuses of each instrument's cell.
    cells = {"84047": first["cell_id"]}
    for serial, pool in zip(instruments[1:], pools[1:4], strict=True):
        cells[serial] = _place(client, pool, mon, instrument=serial)["cell_id"]
    later = iter(pools[4:])
    for offset in (2, 4):
        for serial in instruments:
            choice = {"mode": "existing", "cell_id": cells[serial]}
            _place(client, next(later), mon + timedelta(days=offset), instrument=serial, cell_choice=choice)
    assert _count() == small
    assert small <= 3
