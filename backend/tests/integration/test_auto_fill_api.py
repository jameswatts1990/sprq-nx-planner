"""POST /api/auto-fill: the "auto schedule" assist over a user-selected set of empty
grid cells. Fills only the requested cells, skips ones that filled up in the meantime,
and reports what didn't fit."""
from datetime import date, timedelta

SIX_DISJOINT = "sample,barcodes\n" + "\n".join(f"X{i},bcx{i}" for i in range(1, 7))
TEN_DISJOINT = "sample,barcodes\n" + "\n".join(f"Y{i},bcy{i}" for i in range(1, 11))
TWENTY_FOUR_DISJOINT = "sample,barcodes\n" + "\n".join(f"Z{i},bcz{i}" for i in range(1, 25))
# 8 standard-priority samples entered first, then 1 high-priority sample entered last -
# the pre-priority engine sorted by external id, so W9 (high priority but alphabetically
# last) would have lost out to W1..W8 for the single day's 8 wells.
NINE_WITH_ONE_HIGH_PRIORITY = "sample,barcodes,priority\n" + "\n".join(
    f"W{i},bcw{i},Standard (3)" for i in range(1, 9)
) + "\nW9,bcw9,High (1)"


def _next_monday_tuesday() -> tuple[str, str]:
    d = date.today()
    while d.weekday() != 0:
        d += timedelta(days=1)
    return d.isoformat(), (d + timedelta(days=1)).isoformat()


def _next_working_week() -> list[str]:
    d = date.today()
    while d.weekday() != 0:
        d += timedelta(days=1)
    return [(d + timedelta(days=i)).isoformat() for i in range(5)]


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

    # one grid slot now has 8 wells (two trays of 4); only 1 day is on offer so depth is
    # capped to 1 regardless of objective (a cell can't be reused same-day) - 6 disjoint
    # samples => one fresh cell each, all fit in one run => 6 placed, 0 unplaced
    assert len(body["placed_sample_ids"]) == 6
    assert len(body["unplaced_sample_ids"]) == 0
    assert body["skipped_cells"] == []
    assert len(body["runs"]) == 1
    run = body["runs"][0]
    assert run["instrument_serial"] == "84047"
    assert run["run_date"] == mon
    assert len(run["stages"]) == 6

    # only the requested instrument got a run
    assert client.get("/api/cycles", params={"instrument_serial": "84098"}).json() == []
    assert client.get("/api/samples", params={"status": "scheduled"}).json()["total"] == 6
    assert client.get("/api/samples", params={"status": "backlog"}).json()["total"] == 0


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
    # 5 remained in backlog after the manual placement; 8 wells on 84098 => all 5 fit, 0 unplaced
    assert len(body["placed_sample_ids"]) == 5
    assert len(body["unplaced_sample_ids"]) == 0


def test_auto_fill_skips_day_locked_by_its_own_earlier_run(client):
    """A full 8-well run (both trays loaded) locks the instrument for the whole movie
    plus a settle buffer, which can span into the next calendar day. The engine itself
    is lock-aware (see fill_slots' instrument_open_from tracking) and simply never
    proposes an assignment on a day it knows will be locked - so the 2 overflow samples
    (no reuse possible: max_uses=1) come back unplaced without ever touching Tuesday,
    rather than being planned there and rejected at persist time."""
    client.post("/api/imports", json={"raw_text": TEN_DISJOINT})
    mon, tue = _next_monday_tuesday()

    # max_uses=1 forces one fresh cell per sample - with 2 days on offer, max_uses=3
    # (auto-fill's default) would otherwise let each cell reuse into a second day and
    # sidestep the single-day well exhaustion this test means to exercise.
    resp = _auto_fill(
        client,
        [{"instrument_serial": "84047", "run_date": mon}, {"instrument_serial": "84047", "run_date": tue}],
        max_uses=1,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # Monday's 8 wells (both trays) fill first, loading tray 2 => locked well past
    # Tuesday's own noon start, so the engine skips offering Tuesday at all.
    assert len(body["placed_sample_ids"]) == 8
    assert len(body["unplaced_sample_ids"]) == 2
    assert body["skipped_cells"] == []
    assert len(body["runs"]) == 1
    assert body["runs"][0]["run_date"] == mon

    # Monday's run persisted despite Tuesday's conflict.
    assert client.get("/api/samples", params={"status": "scheduled"}).json()["total"] == 8


def test_auto_fill_reuses_cells_a_third_time_skipping_locked_days(client):
    """Reproduces a reported bug: a full working week offered for one instrument, with
    max_uses=3, should pack 24 disjoint samples onto 8 cells (3 uses each) and schedule
    them on Monday/Wednesday/Friday only - each full 8-well run locks the instrument
    past the immediately following day (see instrument_lock.cycle_lock_until), so
    Tuesday and Thursday are never actually usable. Before fill_slots became
    lock-aware, it planned reuse into Monday/Tuesday/Wednesday instead (ignorant of the
    lock); Tuesday's assignments were then silently rejected at persist time, so every
    cell's third use was effectively unreachable."""
    client.post("/api/imports", json={"raw_text": TWENTY_FOUR_DISJOINT})
    mon, _tue, wed, _thu, fri = _next_working_week()

    resp = _auto_fill(
        client,
        [{"instrument_serial": "84047", "run_date": d} for d in _next_working_week()],
        objective="fewest",
        max_uses=3,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert len(body["placed_sample_ids"]) == 24
    assert len(body["unplaced_sample_ids"]) == 0
    assert body["skipped_cells"] == []
    assert sorted(r["run_date"] for r in body["runs"]) == [mon, wed, fri]
    for run in body["runs"]:
        assert len(run["stages"]) == 8


def test_auto_fill_keeps_a_reused_cell_on_one_instrument_when_multiple_are_offered(client):
    """Reproduces a reported bug: the user ctrl-clicked every day for every instrument
    (mirrors offering a full working week across TWO instruments here) and pressed Auto
    Schedule; a single physical cell's Use 1/2/3 came back on three different
    instruments. 24 disjoint samples at max_uses=3 pack onto 8 cells needing 3 uses
    each; instrument 84047 alone has enough Mon/Wed/Fri capacity to hold all of them
    (see test_auto_fill_reuses_cells_a_third_time_skipping_locked_days) - offering
    84098 too must never tempt a cell into using it mid-lifecycle, and each cell's Use
    1/2/3 labels must land in true chronological order."""
    client.post("/api/imports", json={"raw_text": TWENTY_FOUR_DISJOINT})
    week = _next_working_week()

    resp = _auto_fill(
        client,
        [{"instrument_serial": serial, "run_date": d} for serial in ("84047", "84098") for d in week],
        objective="fewest",
        max_uses=3,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert len(body["placed_sample_ids"]) == 24
    assert len(body["unplaced_sample_ids"]) == 0
    assert body["skipped_cells"] == []

    # Every cell's stages, across every run in the response, must resolve to exactly
    # one instrument - never split across two - and its Use 1/2/3 labels must land in
    # true chronological (run_date) order.
    instruments_by_cell: dict[str, set[str]] = {}
    dates_by_use_number: dict[str, dict[int, str]] = {}
    for run in body["runs"]:
        for stage in run["stages"]:
            instruments_by_cell.setdefault(stage["cell_ref"], set()).add(run["instrument_serial"])
            dates_by_use_number.setdefault(stage["cell_ref"], {})[stage["use_number"]] = run["run_date"]

    assert len(instruments_by_cell) == 8  # 8 cells, 3 uses each = 24 samples
    for cell_ref, instruments in instruments_by_cell.items():
        assert instruments == {"84047"}, f"{cell_ref} spans instruments {instruments}"
    for cell_ref, by_use in dates_by_use_number.items():
        assert by_use[1] < by_use[2] < by_use[3], f"{cell_ref} use dates out of order: {by_use}"


def test_auto_fill_prioritizes_higher_priority_sample_over_wells_scarcity(client):
    """Reproduces a reported gap: auto-schedule should prioritize higher-priority
    samples when capacity is scarce. W9 is High priority but was imported last (and
    would sort last alphabetically too) - with only 8 wells on offer for 9 disjoint
    samples, it must still be the one that gets placed, bumping a Standard-priority
    sample to unplaced instead."""
    client.post("/api/imports", json={"raw_text": NINE_WITH_ONE_HIGH_PRIORITY})
    (mon,) = _weekdays(1)

    resp = _auto_fill(client, [{"instrument_serial": "84047", "run_date": mon}], max_uses=1)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert len(body["placed_sample_ids"]) == 8
    assert len(body["unplaced_sample_ids"]) == 1

    w9_id = _sid(client, "W9")
    assert w9_id in body["placed_sample_ids"]


def test_auto_fill_rejects_weekend_cell(client):
    client.post("/api/imports", json={"raw_text": SIX_DISJOINT})
    resp = _auto_fill(client, [{"instrument_serial": "84047", "run_date": _next_saturday()}])
    assert resp.status_code == 400
    assert "weekend" in resp.json()["detail"].lower()
