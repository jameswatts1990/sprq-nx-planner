"""Regressions from the 2026-10-12 scheduling audit: schedules the instrument can't run.

Every path that puts a use on a cell - manual drop, move, reschedule, auto-fill, Cell QC re-zip -
must keep each physical cell to one use per calendar day, never put a use ahead of one that has
already started, never insert an earlier use that pushes a booked one past the 108h window, and
never mint a second physical tray into a bay whose tray still has uses to run. See
docs/pacbio-sprq-nx-scheduling-reference.md.
"""
from datetime import date, timedelta

from sqlalchemy import select

from app.models.schedule import CellUse, Cycle
from tests.integration._qc_helpers import qc_commit, qc_preview

SERIAL = "84047"


def _monday(weeks_ahead: int = 1) -> date:
    d = date.today() + timedelta(days=1)
    while d.weekday() != 0:
        d += timedelta(days=1)
    return d + timedelta(weeks=weeks_ahead - 1)


def _import(client, names: list[str], movie: int | None = None) -> None:
    if movie is None:
        raw = "sample,barcodes\n" + "\n".join(f"{n},bc{n}" for n in names)
    else:
        raw = "sample,barcodes,movie_time_hours\n" + "\n".join(f"{n},bc{n},{movie}" for n in names)
    assert client.post("/api/imports", json={"raw_text": raw}).status_code in (200, 201)


def _sid(client, pool_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["pool_id"] == pool_id)


def _place(client, name: str, day: date, slot: int, cell_choice: dict | None = None):
    body = {"sample_id": _sid(client, name), "instrument_serial": SERIAL, "load_date": day.isoformat(), "slot_index": slot}
    if cell_choice is not None:
        body["cell_choice"] = cell_choice
    return client.post("/api/cell-uses", json=body)


def _stages(run: dict) -> list[dict]:
    return [dict(s, plate_index=p["plate_index"]) for p in run["plates"] for s in p["stages"]]


def _cells(client, tray_id: int) -> list[dict]:
    items = client.get("/api/cells", params={"tray_id": tray_id, "page_size": 10}).json()["items"]
    return sorted(items, key=lambda c: c["tray_position"])


def _tray_on(client, day: date, prefix: str) -> tuple[int, list[dict], int]:
    """Load 4 samples onto one fresh tray's 4 cells on `day`; returns (tray_id, cells, run_id)."""
    r = _place(client, f"{prefix}0", day, 0, {"mode": "new"})
    assert r.status_code == 201, r.text
    tray_id = _stages(r.json())[0]["tray_id"]
    cells = _cells(client, tray_id)
    for i in (1, 2, 3):
        rr = _place(client, f"{prefix}{i}", day, i, {"mode": "existing", "cell_id": cells[i]["id"]})
        assert rr.status_code == 201, rr.text
    return tray_id, cells, r.json()["run_id"]


def _fill(client, prefix: str, day: date, cells: list[dict]) -> int:
    run_id = None
    for i in range(4):
        rr = _place(client, f"{prefix}{i}", day, i, {"mode": "existing", "cell_id": cells[i]["id"]})
        assert rr.status_code == 201, rr.text
        run_id = rr.json()["run_id"]
    return run_id


def _days_by_cell(db_session) -> dict[int, list[date]]:
    rows = db_session.execute(
        select(CellUse.cell_id, Cycle.acquire_date).join(CellUse.cycle).where(CellUse.status != "cancelled")
    ).all()
    out: dict[int, list[date]] = {}
    for cell_id, day in rows:
        out.setdefault(cell_id, []).append(day)
    return out


def _no_cell_twice_a_day(db_session) -> None:
    doubled = {cid: sorted(days) for cid, days in _days_by_cell(db_session).items() if len(days) != len(set(days))}
    assert not doubled, f"a cell runs twice on one day: {doubled}"


def _confirm(client, run_id: int, day: date) -> None:
    r = client.patch(f"/api/cycles/{run_id}", json={"status": "running", "at": f"{day.isoformat()}T12:00:00Z"})
    assert r.status_code == 200, r.text


# --- one use per cell per day --------------------------------------------------------------


def test_a_plate2_drop_never_reuses_a_cell_on_a_day_it_already_runs(client, db_session):
    _import(client, ["S1", "S2", "S3"])
    mon = _monday()
    cell1 = _stages(_place(client, "S1", mon, 0).json())[0]["cell_id"]
    tue = _place(client, "S2", mon + timedelta(days=1), 0)  # cross-run reuse of cell 1 on Tuesday
    assert _stages(tue.json())[0]["cell_id"] == cell1
    # Monday's Plate 2 reuses Plate 1's cells and acquires Tuesday - cell 1 is already busy then.
    assert _place(client, "S3", mon, 4).status_code == 201
    _no_cell_twice_a_day(db_session)


def test_reschedule_refuses_a_day_one_of_its_cells_already_runs(client, db_session):
    _import(client, ["S1", "S2", "S3"])
    mon = _monday()
    cell1 = _stages(_place(client, "S1", mon, 0).json())[0]["cell_id"]
    assert _place(client, "S2", mon, 4).status_code == 201  # Plate-2 reuse of cell 1, acquiring Tuesday
    wed = _place(client, "S3", mon + timedelta(days=2), 0)
    assert _stages(wed.json())[0]["cell_id"] == cell1
    resp = client.post(f"/api/cycles/{wed.json()['run_id']}/reschedule", json={"new_load_date": (mon + timedelta(days=1)).isoformat()})
    assert resp.status_code == 409, resp.text
    assert "once per day" in resp.json()["detail"]
    _no_cell_twice_a_day(db_session)


def test_auto_fill_never_reuses_a_cell_on_its_plate2_acquire_day(client, db_session):
    _import(client, ["S1", "S2", "S3"])
    mon = _monday()
    assert _place(client, "S1", mon, 0).status_code == 201
    assert _place(client, "S2", mon, 4).status_code == 201  # Plate-2 reuse acquiring Tuesday
    resp = client.post("/api/auto-fill", json={"cells": [{"instrument_serial": SERIAL, "load_date": (mon + timedelta(days=1)).isoformat()}]})
    assert resp.status_code == 200, resp.text
    _no_cell_twice_a_day(db_session)


def test_auto_fill_bundled_plate2_that_slips_a_day_never_doubles_a_cell(client, db_session):
    # A late (20:00) load chains the bundled Plate 2 a further day, onto the day the packer
    # planned the cell's next separate run - the persist re-check must catch it.
    _import(client, [f"L{i}" for i in range(1, 13)], movie=24)
    mon = _monday()
    resp = client.post(
        "/api/auto-fill",
        json={
            "cells": [{"instrument_serial": SERIAL, "load_date": (mon + timedelta(days=i)).isoformat()} for i in range(3)],
            "movie_times": [24],
            "objective": "fewest",
            "cells_per_day": 8,
            "start_hour": 20,
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["placed_sample_ids"]
    _no_cell_twice_a_day(db_session)


# --- strictly sequential once a use has started ------------------------------------------


def test_reschedule_refuses_moving_ahead_of_a_started_use(client):
    _import(client, ["S1", "S2"])
    mon = _monday()
    r1 = _place(client, "S1", mon, 0)
    _confirm(client, r1.json()["run_id"], mon)
    wed = _place(client, "S2", mon + timedelta(days=2), 0)
    resp = client.post(f"/api/cycles/{wed.json()['run_id']}/reschedule", json={"new_load_date": (mon - timedelta(days=3)).isoformat()})
    assert resp.status_code == 409, resp.text


def test_same_well_move_ahead_of_a_started_use_takes_another_cell(client):
    _import(client, ["S1", "S2"])
    mon = _monday()
    r1 = _place(client, "S1", mon, 0)
    cell1 = _stages(r1.json())[0]["cell_id"]
    _confirm(client, r1.json()["run_id"], mon)
    wed = _stages(_place(client, "S2", mon + timedelta(days=2), 0).json())[0]
    assert wed["cell_id"] == cell1
    mv = client.post(
        f"/api/cell-uses/{wed['cell_use_id']}/move",
        json={"instrument_serial": SERIAL, "load_date": (mon - timedelta(days=3)).isoformat(), "slot_index": 0, "run_time_hours": 24},
    )
    assert mv.status_code == 200, mv.text
    assert _stages(mv.json())[0]["cell_id"] != cell1


# --- 108h window: an earlier insert can't push a booked use out ----------------------------


def test_an_earlier_drop_never_reuses_a_later_booked_tray(client):
    _import(client, ["N1", "E1"])
    next_mon = _monday(2)
    cell_next = _stages(_place(client, "N1", next_mon, 0).json())[0]["cell_id"]
    wed = _place(client, "E1", _monday() + timedelta(days=2), 0)  # 120h before next Monday's use
    assert wed.status_code == 201, wed.text
    assert _stages(wed.json())[0]["cell_id"] != cell_next


def test_auto_fill_never_inserts_ahead_of_a_later_booked_use(client, db_session):
    _import(client, ["N1", "A1"])
    next_mon = _monday(2)
    cell_next = _stages(_place(client, "N1", next_mon, 0).json())[0]["cell_id"]
    resp = client.post(
        "/api/auto-fill",
        json={"cells": [{"instrument_serial": SERIAL, "load_date": (_monday() + timedelta(days=2)).isoformat()}], "cells_per_day": 4},
    )
    assert resp.status_code == 200, resp.text
    assert len(_days_by_cell(db_session)[cell_next]) == 1


def test_auto_fill_never_reuses_an_expired_cell(client, db_session):
    _import(client, ["P1", "Q1", "Q2"])
    cell1 = _stages(_place(client, "P1", _monday(), 0).json())[0]["cell_id"]
    resp = client.post(
        "/api/auto-fill",
        json={"cells": [{"instrument_serial": SERIAL, "load_date": _monday(2).isoformat()}], "cells_per_day": 4},
    )
    assert resp.status_code == 200, resp.text
    assert len(resp.json()["placed_sample_ids"]) == 2  # onto a fresh tray, not stranded
    assert len(_days_by_cell(db_session)[cell1]) == 1  # 168h after its first use - out of window


# --- bays: a tray stays resident until its last use has run --------------------------------


def test_a_fresh_tray_never_lands_in_a_bay_whose_tray_still_has_uses(client):
    mon = _monday()
    _import(client, [f"M{i}" for i in range(4)] + [f"W{i}" for i in range(4)] + [f"F{i}" for i in range(4)] + ["T0", "P0", "X0"])
    t1, cells, _ = _tray_on(client, mon, "M")
    _fill(client, "W", mon + timedelta(days=2), cells)
    _fill(client, "F", mon + timedelta(days=4), cells)  # T1 is "exhausted" by schedule, still in bay 1 until Friday
    tue = _place(client, "T0", mon + timedelta(days=1), 0)
    assert tue.status_code == 201, tue.text
    t2 = _stages(tue.json())[0]["tray_id"]
    assert t2 != t1
    assert {c["current_well"] for c in _cells(client, t2)} == {"A02", "B02", "C02", "D02"}  # the free bay
    # Both bays now hold a tray with uses to run - a third tray has nowhere to go.
    third = _place(client, "X0", mon + timedelta(days=1), 4, {"mode": "new"})
    assert third.status_code == 409, third.text


# --- swap / same-well move ----------------------------------------------------------------


def test_swap_moves_the_movie_time_with_the_sample(client):
    raw = "sample,barcodes,movie_time_hours\nX,bx,12\nY,by,30"
    client.post("/api/imports", json={"raw_text": raw})
    mon = _monday()
    _place(client, "X", mon, 0)
    run = _place(client, "Y", mon, 1).json()
    sx = next(s for s in _stages(run) if s["sample_pool_id"] == "X")
    sy = next(s for s in _stages(run) if s["sample_pool_id"] == "Y")
    resp = client.post(f"/api/cell-uses/{sx['cell_use_id']}/swap", json={"other_cell_use_id": sy["cell_use_id"]})
    assert resp.status_code == 200, resp.text
    after = {s["sample_pool_id"]: s["run_time_hours"] for s in _stages(resp.json()[0])}
    assert after == {"X": 12, "Y": 30}


def test_same_well_move_onto_another_trays_plate_takes_that_tray(client):
    mon = _monday()
    _import(client, [f"M{i}" for i in range(4)] + ["T0"])
    t1, _cells_t1, mon_run = _tray_on(client, mon, "M")
    tue = _place(client, "T0", mon + timedelta(days=1), 1, {"mode": "new"})  # Tuesday's Plate 1 is tray T2
    t2 = _stages(tue.json())[0]["tray_id"]
    a01 = next(s for s in _stages(client.get(f"/api/cycles/{mon_run}").json()) if s["well"] == "A01")
    mv = client.post(
        f"/api/cell-uses/{a01['cell_use_id']}/move",
        json={"instrument_serial": SERIAL, "load_date": (mon + timedelta(days=1)).isoformat(), "slot_index": 0, "run_time_hours": 24},
    )
    assert mv.status_code == 200, mv.text
    assert {s["tray_id"] for s in _stages(mv.json()) if s["plate_index"] == 1} == {t2}
    assert t1 != t2


def test_same_well_move_never_gives_a_discarded_cell_a_new_use(client):
    mon = _monday()
    _import(client, [f"M{i}" for i in range(4)])
    t1, _cells_t1, mon_run = _tray_on(client, mon, "M")
    rot = client.post("/api/cells/rotate-tray", json={"tray_id": t1, "from_date": mon.isoformat(), "reason": "bin"})
    assert rot.status_code == 200, rot.text
    a01 = next(s for s in _stages(client.get(f"/api/cycles/{mon_run}").json()) if s["well"] == "A01")
    mv = client.post(
        f"/api/cell-uses/{a01['cell_use_id']}/move",
        json={"instrument_serial": SERIAL, "load_date": (mon + timedelta(days=3)).isoformat(), "slot_index": 0, "run_time_hours": 24},
    )
    assert mv.status_code == 200, mv.text
    cell = client.get(f"/api/cells/{_stages(mv.json())[0]['cell_id']}").json()
    assert cell["discarded_at"] is None


# --- Cell QC re-zip is per plate -----------------------------------------------------------


def test_fail_and_stop_rezips_each_plate_on_its_own_cells(client):
    mon = _monday()
    wed, fri = mon + timedelta(days=2), mon + timedelta(days=4)
    _import(client, [f"M{i}" for i in range(4)] + [f"W{i}" for i in range(4)] + [f"F{i}" for i in range(4)])
    _t1, cells, mon_run = _tray_on(client, mon, "M")
    wed_run = _fill(client, "W", wed, cells)
    fri_run = _fill(client, "F", fri, cells)
    _confirm(client, mon_run, mon)
    cell_a = cells[0]["id"]
    use = next(s["cell_use_id"] for s in _stages(client.get(f"/api/cycles/{mon_run}").json()) if s["cell_id"] == cell_a)
    affected = qc_preview(client, cell_a, "fail_and_stop", use).json()["affected_samples"]
    displaced = sorted((a["run_date"], a["well"]) for a in affected if a["role"] == "displaced")
    assert displaced == [(wed.isoformat(), "D01"), (fri.isoformat(), "D01")]  # each plate's tail, nothing more
    disp = {a["sample_id"]: "recoverable" for a in affected if a["disposition_required"]}
    assert qc_commit(client, cell_a, "fail_and_stop", use, disp).status_code == 200
    for run_id in (wed_run, fri_run):
        live = [s for s in _stages(client.get(f"/api/cycles/{run_id}").json()) if s["cell_use_status"] != "cancelled"]
        cells_on_plate = [s["cell_id"] for s in live]
        assert len(cells_on_plate) == 3 and len(set(cells_on_plate)) == 3  # one cell per well
        assert cell_a not in cells_on_plate


def test_retire_from_an_anchor_leaves_earlier_plates_alone(client):
    mon = _monday()
    _import(client, [f"M{i}" for i in range(4)] + [f"W{i}" for i in range(4)])
    _t1, cells, mon_run = _tray_on(client, mon, "M")
    wed_run = _fill(client, "W", mon + timedelta(days=2), cells)
    cell_a = cells[0]["id"]
    wed_use = next(s["cell_use_id"] for s in _stages(client.get(f"/api/cycles/{wed_run}").json()) if s["cell_id"] == cell_a)
    affected = qc_preview(client, cell_a, "retire", wed_use).json()["affected_samples"]
    assert all(a["run_date"] != mon.isoformat() for a in affected)


def test_a_retired_cell_never_holds_its_tray_back_from_dial_disposal(client, db_session):
    from app.services.auto_fill_service import _dispose_tray_if_fully_used
    from app.timeutil import utcnow
    from tests.integration._qc_helpers import qc_retire

    mon = _monday()
    _import(client, [f"M{i}" for i in range(4)] + [f"W{i}" for i in range(4)])
    tray_id, cells, _mon_run = _tray_on(client, mon, "M")
    for i in (1, 2, 3):
        assert _place(client, f"W{i}", mon + timedelta(days=2), i, {"mode": "existing", "cell_id": cells[i]["id"]}).status_code == 201
    assert qc_retire(client, cells[0]["id"]).status_code == 200
    # Cells 2-4 have reached a 2x dial; the retired cell 1 has nothing left to give.
    disposed = _dispose_tray_if_fully_used(db_session, tray_id, 2, utcnow())
    assert sorted(disposed) == sorted(c["id"] for c in cells[1:])


def test_undo_qc_never_double_books_a_displaced_sample_placed_again(client):
    mon = _monday()
    wed, fri = mon + timedelta(days=2), mon + timedelta(days=4)
    _import(client, [f"M{i}" for i in range(4)] + [f"W{i}" for i in range(4)])
    _t1, cells, mon_run = _tray_on(client, mon, "M")
    _fill(client, "W", wed, cells)
    _confirm(client, mon_run, mon)
    cell_a = cells[0]["id"]
    use = next(s["cell_use_id"] for s in _stages(client.get(f"/api/cycles/{mon_run}").json()) if s["cell_id"] == cell_a)
    affected = qc_preview(client, cell_a, "fail_and_stop", use).json()["affected_samples"]
    disp = {a["sample_id"]: "recoverable" for a in affected if a["disposition_required"]}
    assert qc_commit(client, cell_a, "fail_and_stop", use, disp).status_code == 200
    displaced = next(a for a in affected if a["role"] == "displaced")
    again = _place(client, displaced["pool_id"], fri, 4, {"mode": "new"})
    assert again.status_code == 201, again.text

    undo = client.post(f"/api/cells/{cell_a}/qc/undo")
    assert undo.status_code == 200, undo.text
    assert displaced["cell_use_id"] in undo.json()["drifted_cell_use_ids"]
    sample = client.get(f"/api/samples/{displaced['sample_id']}").json()
    assert sample["status"] == "scheduled"
