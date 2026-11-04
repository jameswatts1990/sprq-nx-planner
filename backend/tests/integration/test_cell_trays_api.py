"""GET /api/cells/trays - the Cells page's one-row-per-tray list - and the projected-status SQL
pre-filter both list endpoints use when as_of is set."""
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select

from app.models.cell import Cell
from app.schemas.cell import CellBootstrapRequest
from app.services.cell_service import bootstrap_cell


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


def _place(client, pool_id: str, load_date: str, cell_choice: dict, instrument: str = "84047") -> int:
    r = client.post(
        "/api/cell-uses",
        json={
            "sample_id": _sid(client, pool_id),
            "instrument_serial": instrument,
            "load_date": load_date,
            "slot_index": 0,
            "cell_choice": cell_choice,
            "run_time_hours": 24,
        },
    )
    assert r.status_code == 201, r.text
    return next(s for p in r.json()["plates"] for s in p["stages"] if s["sample_pool_id"] == pool_id)["cell_id"]


def _now() -> str:
    return datetime.now(UTC).isoformat()


def test_a_row_carries_the_whole_tray_and_marks_the_cells_that_matched(client, db_session):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nPOOLA,bc1"})
    (mon,) = _weekdays(1)
    used = _place(client, "POOLA", mon, {"mode": "new"})

    # Search hits only the cell that ran POOLA, but the row still shows all four tray-mates.
    body = client.get("/api/cells/trays", params={"q": "POOLA", "as_of": _now()}).json()
    assert body["total"] == 1
    (row,) = body["items"]
    assert [c["tray_position"] for c in row["cells"]] == [1, 2, 3, 4]
    assert row["matched_cell_ids"] == [used]
    assert row["instrument_serial"] == "84047"
    # "As of now" the Monday use hasn't happened yet, but it is booked - so it isn't free to book.
    (used_cell,) = (c for c in row["cells"] if c["id"] == used)
    assert (used_cell["uses_consumed"], used_cell["uses_scheduled_later"]) == (0, 1)
    assert row["uses_left"] == 11

    # A status filter matching part of the tray behaves the same way.
    stopped = db_session.scalar(select(Cell).where(Cell.id != used, Cell.tray_position == 4))
    stopped.status = "stopped"
    stopped.stopped_at = datetime.now(UTC)
    db_session.commit()
    (row,) = client.get("/api/cells/trays", params={"status": "stopped", "as_of": _now()}).json()["items"]
    assert len(row["cells"]) == 4
    assert row["matched_cell_ids"] == [stopped.id]
    (row,) = client.get("/api/cells/trays", params={"status": "open", "as_of": _now()}).json()["items"]
    assert len(row["cells"]) == 4
    assert stopped.id not in row["matched_cell_ids"]
    assert row["uses_left"] == 8  # a stopped cell's capacity is lost


def test_trays_sort_and_page_by_tray_and_trayless_cells_get_their_own_row(client, db_session):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA,bca\nB,bcb"})
    (mon,) = _weekdays(1)
    _place(client, "A", mon, {"mode": "new"}, instrument="84047")
    _place(client, "B", mon, {"mode": "new"}, instrument="84098")
    bootstrap_cell(db_session, CellBootstrapRequest(uses_consumed=1, burned_barcodes=["bcx"], instrument_serial="84093"))
    db_session.commit()

    body = client.get("/api/cells/trays", params={"sort_by": "tray", "sort_dir": "asc", "as_of": _now()}).json()
    assert body["total"] == 3
    tray_ids = [r["tray_id"] for r in body["items"]]
    assert tray_ids[2] is None  # no tray to sort on - always trails
    assert tray_ids[0] < tray_ids[1]
    assert len(body["items"][2]["cells"]) == 1

    page2 = client.get(
        "/api/cells/trays", params={"sort_by": "tray", "sort_dir": "asc", "page": 2, "page_size": 1, "as_of": _now()}
    ).json()
    assert page2["total"] == 3
    assert [r["tray_id"] for r in page2["items"]] == [tray_ids[1]]

    assert client.get("/api/cells/trays", params={"sort_by": "colour"}).status_code == 400
    assert client.get("/api/cells/trays", params={"sort_dir": "up"}).status_code == 400


def test_projected_status_prefilter_matches_filtering_the_full_projection(client, db_session):
    """The SQL pre-filter must never drop a cell the as_of projection would show: compare each
    status filter against the unfiltered list filtered in Python, at several reference instants.
    Covers the tricky case - a cell persisted exhausted only because its uses are still in the
    future, which reads open now - plus window expiry that only happens later."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nM,bcm\nT,bct\nW,bcw\nX,bcx"})
    mon, tue, wed = _weekdays(3)
    cell = _place(client, "M", mon, {"mode": "new"})
    _place(client, "T", tue, {"mode": "existing", "cell_id": cell})
    _place(client, "W", wed, {"mode": "existing", "cell_id": cell})
    assert db_session.get(Cell, cell).status == "exhausted"
    _place(client, "X", mon, {"mode": "new"}, instrument="84098")
    now = datetime.now(UTC)
    for hours_ago in (50, 200):
        bootstrap_cell(
            db_session,
            CellBootstrapRequest(
                uses_consumed=1,
                burned_barcodes=[f"bc{hours_ago}"],
                first_use_started_at=now - timedelta(hours=hours_ago),
                instrument_serial="84093",
            ),
        )
    db_session.commit()

    for as_of in (now, now + timedelta(days=4), now + timedelta(days=30)):
        everything = client.get("/api/cells", params={"as_of": as_of.isoformat(), "page_size": 500}).json()["items"]
        for status in ("open", "exhausted", "window_expired", "retired", "stopped"):
            filtered = client.get(
                "/api/cells", params={"status": status, "as_of": as_of.isoformat(), "page_size": 500}
            ).json()["items"]
            expected = sorted(c["id"] for c in everything if c["status"] == status)
            assert sorted(c["id"] for c in filtered) == expected, (as_of, status)

    # The tricky cell really is projected open now, exhausted once its uses have happened.
    now_view = client.get("/api/cells", params={"status": "open", "as_of": now.isoformat()}).json()["items"]
    assert cell in [c["id"] for c in now_view]
