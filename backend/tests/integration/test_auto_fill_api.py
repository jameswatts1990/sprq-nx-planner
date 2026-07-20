"""POST /api/auto-fill: the "auto schedule" assist over a user-selected set of empty
grid cells. Fills only the requested cells, skips ones that filled up in the meantime,
and reports what didn't fit."""
from datetime import date, datetime, time, timedelta, timezone

from app.models.cell import Cell
from app.models.cell_tray import CellTray
from app.models.schedule import Cycle, RunBatch

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


def _auto_fill(client, cells, objective="fastest", run_time_hours=24, max_uses=3, cells_per_day=8):
    return client.post(
        "/api/auto-fill",
        json={
            "cells": cells,
            "objective": objective,
            "run_time_hours": run_time_hours,
            "max_uses": max_uses,
            "cells_per_day": cells_per_day,
        },
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


def test_auto_fill_shares_one_physical_tray_across_fresh_cells_in_the_same_box(client, db_session):
    """Reproduces a reported bug: auto-filling several *different* first-use samples into
    the same day's tray-1 box (wells A01-D01) opened a brand-new physical CellTray per
    sample instead of sharing the one tray box those 4 wells actually are - e.g. cell ids
    408/413/418/423 (gaps of 5) instead of 408/409/410/411. 6 disjoint samples on one day
    need 6 fresh cells: 4 fill tray-1's box completely, 2 land in tray-2's box - each box
    must end up as exactly one CellTray with 4 Cell rows (all 4 used for tray-1's box; 2
    used + 2 untouched siblings for tray-2's box), never more than one tray per box."""
    client.post("/api/imports", json={"raw_text": SIX_DISJOINT})
    (mon,) = _weekdays(1)

    resp = _auto_fill(client, [{"instrument_serial": "84047", "run_date": mon}])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["placed_sample_ids"]) == 6

    stages = body["runs"][0]["stages"]
    assert len(stages) == 6
    tray1_cell_ids = sorted(s["cell_id"] for s in stages if s["well"] in {"A01", "B01", "C01", "D01"})
    tray2_cell_ids = sorted(s["cell_id"] for s in stages if s["well"] in {"A02", "B02"})
    assert len(tray1_cell_ids) == 4
    assert len(tray2_cell_ids) == 2

    # tray-1's box is fully used by this batch, so its 4 cell ids must be the 4
    # consecutive ids created by one open_new_tray() call - not scattered across
    # several separately-opened trays.
    assert tray1_cell_ids == list(range(tray1_cell_ids[0], tray1_cell_ids[0] + 4))

    # Exactly one CellTray per box (2 boxes touched), each with exactly 4 Cell rows -
    # not one tray per fresh cell (which would be 6 trays / up to 24 cells).
    trays = db_session.query(CellTray).all()
    assert len(trays) == 2
    for tray in trays:
        cells_in_tray = db_session.query(Cell).filter(Cell.tray_id == tray.id).all()
        assert len(cells_in_tray) == 4
        assert sorted(c.tray_position for c in cells_in_tray) == [1, 2, 3, 4]


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


def test_auto_fill_treats_a_stageless_cycle_shell_as_open(client, db_session):
    """Reproduces a reported gap: "Remove from schedule"/"Clear schedule" fire one DELETE
    per stage concurrently (see placement_service.remove_sample's with_for_update
    comment), which can leave a RunBatch+Cycle behind with zero CellUse rows. The grid
    already treats that as an open, selectable cell (groupCyclesByInstrumentAndDay.
    isCellOpen checks stage count, not cycle existence), so a user can select it and press
    Auto Schedule - but auto_fill's own occupied pre-scan previously only checked whether
    a RunBatch row existed at all, silently skipping a cell the UI just showed as empty."""
    client.post("/api/imports", json={"raw_text": SIX_DISJOINT})
    (mon,) = _weekdays(1)

    instrument_id = next(i for i in client.get("/api/instruments").json() if i["serial_number"] == "84047")["id"]
    run_batch = RunBatch(instrument_id=instrument_id, run_date=date.fromisoformat(mon))
    db_session.add(run_batch)
    db_session.flush()
    start = datetime.combine(date.fromisoformat(mon), time(9, 0), tzinfo=timezone.utc)
    db_session.add(
        Cycle(run_batch_id=run_batch.id, movie_hours=24, planned_start_at=start, planned_end_at=start + timedelta(hours=24))
    )
    db_session.commit()

    resp = _auto_fill(client, [{"instrument_serial": "84047", "run_date": mon}])
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["skipped_cells"] == []
    assert len(body["placed_sample_ids"]) == 6
    assert len(body["runs"]) == 1
    assert body["runs"][0]["run_date"] == mon
    assert len(body["runs"][0]["stages"]) == 6


def test_auto_fill_fills_around_a_cancelled_stopped_cell_marker_without_crashing(client):
    """Reproduces the reported "clear a week with a stopped cell in it" bug's Auto Schedule
    half. Stopping a cell before its planned use runs cascades that use to "cancelled" -
    kept forever as a permanent marker occupying its exact well (see cell_service.
    stop_cell), never deleted. isCellOpen already treats such a cycle as open on the
    frontend, and the occupied pre-scan above now agrees - but fill_slots plans every
    offered slot as "8 fully free wells" (SlotInput's own documented invariant), so
    persistence must reassign around the one well that's actually taken rather than crash
    on its unique (cycle_id, well) constraint."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nCM1,bccm1"})
    (mon,) = _weekdays(1)

    r1 = client.post(
        "/api/cell-uses",
        json={
            "sample_id": _sid(client, "CM1"),
            "instrument_serial": "84047",
            "run_date": mon,
            "slot_index": 0,
            "cell_choice": {"mode": "new"},
            "run_time_hours": 24,
            "max_uses": 3,
        },
    )
    assert r1.status_code == 201, r1.text
    cycle_id = r1.json()["cycle_id"]
    cell_id = r1.json()["stages"][0]["cell_id"]

    # Stop the cell before its use runs - CM1 bounces back to backlog, and well A01 is kept
    # forever as a cancelled marker occupying that one slot.
    stop = client.post(f"/api/cells/{cell_id}/stop", json={"reason": "damaged"})
    assert stop.status_code == 200, stop.text

    # 6 more disjoint samples - together with CM1 (back in the backlog), 7 backlog samples
    # on offer for a cycle that has exactly 7 genuinely free wells left (A01 is gone for good).
    client.post(
        "/api/imports", json={"raw_text": "sample,barcodes\n" + "\n".join(f"CM{i},bccm{i}" for i in range(2, 8))}
    )

    resp = _auto_fill(client, [{"instrument_serial": "84047", "run_date": mon}])
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # Not skipped wholesale - a cancelled-only day is genuinely (mostly) open
    assert body["skipped_cells"] == []
    assert len(body["placed_sample_ids"]) == 7
    assert len(body["unplaced_sample_ids"]) == 0

    cycle = client.get(f"/api/cycles/{cycle_id}").json()
    assert len(cycle["stages"]) == 8  # the 1 surviving cancelled marker + 7 freshly placed
    wells = {s["well"] for s in cycle["stages"]}
    assert wells == {"A01", "B01", "C01", "D01", "A02", "B02", "C02", "D02"}
    cancelled = next(s for s in cycle["stages"] if s["cell_use_status"] == "cancelled")
    assert cancelled["well"] == "A01"
    assert cancelled["sample_external_id"] == "CM1"


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


def test_auto_fill_never_exceeds_the_hard_three_use_cap_with_cells_per_day_four(client, db_session):
    """Reproduces a real reported bug: auto-scheduling one instrument across a full
    working week with cells_per_day=4 (tray 1 only - a half-tray run only locks the
    short settle buffer, never the next day, so every weekday is a genuine touch
    point) put 5 real uses on one physical cell, one more than the instrument's hard
    3-use cap. 20 disjoint samples at max_uses=3/cells_per_day=4 exhaust 4 fresh
    cells' own 3-use quota by Wednesday; before the fix, each of tray 1's 4 wells then
    showed "free" again on Thursday (free_wells resets every day) and got handed to a
    brand-new cell for Thu/Fri - which the persistence layer's per-box well cache
    resolved back to the exact same physical Cell as the first occupant, stacking 5
    uses onto one cell instead of opening a 5th distinct one. No cell may ever exceed
    CELL_MAX_USES real (non-cancelled) uses, however many samples are on offer."""
    client.post(
        "/api/imports",
        json={"raw_text": "sample,barcodes\n" + "\n".join(f"Q{i},bcq{i}" for i in range(1, 21))},
    )
    week = _next_working_week()

    resp = _auto_fill(
        client,
        [{"instrument_serial": "84047", "run_date": d} for d in week],
        objective="fewest",
        max_uses=3,
        cells_per_day=4,
    )
    assert resp.status_code == 200, resp.text

    cells = db_session.query(Cell).all()
    assert len(cells) > 0
    for cell in cells:
        active_uses = [cu for cu in cell.cell_uses if cu.status != "cancelled"]
        assert len(active_uses) <= 3, f"{cell.code} has {len(active_uses)} uses - exceeds the hard 3-use cap"


def test_auto_fill_reloads_a_terminal_well_with_a_new_tray_in_the_same_batch(client, db_session):
    """Companion to the hard-cap regression above: fixing the overuse must not
    over-correct into refusing to reload a genuinely terminal well. Once tray 1's 4
    fresh cells exhaust their own 3-use quota by Wednesday, a brand-new physical tray
    is a legitimate thing to plan into the same 4 wells for Thursday/Friday - PacBio's
    own instrument explicitly allows loading a new tray once the old one is spent (see
    cell_service.open_new_tray's "a box whose every cell has gone terminal is not a
    collision" rule). With enough backlog demand (20 disjoint samples), new physical
    cells must open on Thursday and get reused Friday - not silently give up after
    Wednesday.

    Note: 2 of the 20 samples still come back unplaced here (18/20) - a pre-existing,
    separate limitation of pack_cells's depth allocation, not of this reload fix: it
    assigns a flat `min(max_uses, available_days)` depth to every fresh cell without
    knowing that a *second-generation* cell reloaded mid-week (see slot_scheduling.py's
    _well_is_vacated) only has 2 real days left (Thu+Fri), not the full week - so 2 of
    the 7 packed cells are over-committed to 3 planned uses when only 2 can actually be
    placed. This is a safe failure mode (samples are honestly reported unplaced, never
    silently dropped or double-booked) and was never reachable before this fix (a
    terminal well couldn't be reloaded within one batch at all) - a genuine packing
    optimization, not a correctness bug, and left as a follow-up rather than folded into
    this fix."""
    client.post(
        "/api/imports",
        json={"raw_text": "sample,barcodes\n" + "\n".join(f"R{i},bcr{i}" for i in range(1, 21))},
    )
    week = _next_working_week()

    resp = _auto_fill(
        client,
        [{"instrument_serial": "84047", "run_date": d} for d in week],
        objective="fewest",
        max_uses=3,
        cells_per_day=4,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert len(body["placed_sample_ids"]) == 18
    assert len(body["unplaced_sample_ids"]) == 2
    assert sorted(r["run_date"] for r in body["runs"]) == week

    cells = db_session.query(Cell).all()
    # 4 cells for Mon-Wed's first-generation tray, plus a whole new physical tray-of-4
    # reopened Thursday (see cell_service.open_new_tray's "eager tray population" -
    # opening one well opens all 4 physical siblings at once) - only 3 of that second
    # tray's wells had backlog demand, so its 4th cell sits at 0 uses, a real open
    # sibling ready for a future placement rather than a gap.
    assert len(cells) == 8
    uses_per_cell = sorted(len([cu for cu in c.cell_uses if cu.status != "cancelled"]) for c in cells)
    # 4 first-generation cells reach the full 3-use cap (Mon-Wed); of the second
    # generation's 4 tray-mates, 3 get reused Thu+Fri (2 uses each) and the 4th
    # sibling is never touched (0 uses) - none exceed the cap, and a genuinely new
    # tray did open after Wednesday rather than the batch giving up.
    assert uses_per_cell == [0, 2, 2, 2, 3, 3, 3, 3]
    assert max(uses_per_cell) <= 3


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


def test_auto_fill_surfaces_barcode_conflicts_between_backlog_samples(client):
    """Two backlog samples sharing a barcode are kept off the same cell (see
    engine/packing.py's disjoint() check), but the conflict itself must be visible
    (previously computed by pack_cells and silently discarded) rather than only
    preventable at persist time."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nCJ1,shared\nCJ2,shared"})
    (mon,) = _weekdays(1)

    resp = _auto_fill(client, [{"instrument_serial": "84047", "run_date": mon}])
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert len(body["barcode_conflicts"]) == 1
    conflict = body["barcode_conflicts"][0]
    assert {conflict["sample_external_id_a"], conflict["sample_external_id_b"]} == {"CJ1", "CJ2"}
    assert conflict["shared_barcodes"] == ["shared"]
