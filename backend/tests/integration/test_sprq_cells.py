"""Single-use SPRQ cells alongside multi-use SPRQ-Nx cells (v0.62.0).

The load-time dial's toggle picks a brand-new run's cell type. A run is one type across both
plates: later drops inherit it, reuse-before-new holds within the type (leftover SPRQ cells
before a new SPRQ tray), the two types never mix, and Auto Schedule / Recalculate only ever
plan SPRQ-Nx. See docs/pacbio-sprq-nx-scheduling-reference.md, "SPRQ single-use cells"."""
from datetime import date, timedelta

from app.models.cell import Cell
from app.services.cell_service import recompute_status
from app.timeutil import utcnow

EIGHT = "sample,barcodes\n" + "\n".join(f"S{i},bcs{i}" for i in range(1, 9))


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


def _stages(run):
    return [s for p in run["plates"] for s in p["stages"]]


def _stage_for(run, pool_id: str):
    return next(s for s in _stages(run) if s["sample_pool_id"] == pool_id)


def _place(client, pool_id, run_date, slot_index, *, cell_type=None, cell_choice=None, instrument="84047"):
    payload = {
        "sample_id": _sid(client, pool_id),
        "instrument_serial": instrument,
        "load_date": run_date,
        "slot_index": slot_index,
        "run_time_hours": 24,
    }
    if cell_type is not None:
        payload["cell_type"] = cell_type
    if cell_choice is not None:
        payload["cell_choice"] = cell_choice
    return client.post("/api/cell-uses", json=payload)


def _cell(client, cell_id: int):
    return client.get(f"/api/cells/{cell_id}").json()


def _tray_cells(client, tray_id: int):
    return client.get("/api/cells", params={"tray_id": tray_id, "page_size": 50}).json()["items"]


def _import(client):
    assert client.post("/api/imports", json={"raw_text": EIGHT}).status_code in (200, 201)


def test_sprq_first_drop_opens_a_single_use_tray(client):
    _import(client)
    (mon,) = _weekdays(1)

    r = _place(client, "S1", mon, 0, cell_type="sprq")
    assert r.status_code == 201, r.text
    run = r.json()
    assert run["cell_type"] == "sprq"
    stage = _stage_for(run, "S1")
    assert stage["cell_type"] == "sprq"
    assert stage["cell_max_uses"] == 1

    tray = _tray_cells(client, _cell(client, stage["cell_id"])["tray_id"])
    assert len(tray) == 4
    assert all(c["cell_type"] == "sprq" and c["max_uses"] == 1 for c in tray)
    # One use and it's spent - a SPRQ cell is never offered again.
    used = _cell(client, stage["cell_id"])
    assert used["status"] == "exhausted"
    assert used["uses_remaining"] == 0


def test_a_plain_drop_still_opens_sprq_nx(client):
    _import(client)
    (mon,) = _weekdays(1)

    r = _place(client, "S1", mon, 0)
    assert r.status_code == 201, r.text
    assert r.json()["cell_type"] == "sprq_nx"
    stage = _stage_for(r.json(), "S1")
    assert stage["cell_type"] == "sprq_nx"
    assert stage["cell_max_uses"] == 3


def test_later_drops_into_a_sprq_run_take_sprq_cells_on_both_plates(client):
    _import(client)
    (mon,) = _weekdays(1)

    assert _place(client, "S1", mon, 0, cell_type="sprq").status_code == 201
    # No type sent - the run's type is inherited (no dial for an existing run).
    assert _place(client, "S2", mon, 1).status_code == 201
    r = _place(client, "S3", mon, 4)
    assert r.status_code == 201, r.text

    run = r.json()
    assert run["cell_type"] == "sprq"
    assert {s["cell_type"] for s in _stages(run)} == {"sprq"}
    # A SPRQ cell can't be reused, so Plate 2 is a parallel fresh SPRQ tray, not a reuse plate.
    plate2 = next(p for p in run["plates"] if p["plate_index"] == 2)
    assert plate2["is_reuse"] is False
    assert all(s["use_number"] == 1 for s in _stages(run))


def test_a_new_sprq_run_uses_leftover_sprq_cells_before_a_new_tray(client):
    _import(client)
    mon, tue = _weekdays(2)

    r1 = _place(client, "S1", mon, 0, cell_type="sprq")
    assert _place(client, "S2", mon, 1).status_code == 201
    sprq_tray = _cell(client, _stage_for(r1.json(), "S1")["cell_id"])["tray_id"]

    r2 = _place(client, "S3", tue, 0, cell_type="sprq")
    assert r2.status_code == 201, r2.text
    s3 = _stage_for(r2.json(), "S3")
    assert _cell(client, s3["cell_id"])["tray_id"] == sprq_tray


def test_sprq_and_sprq_nx_never_share_cells(client):
    _import(client)
    mon, tue, wed = _weekdays(3)

    nx = _place(client, "S1", mon, 0)
    nx_tray = _cell(client, _stage_for(nx.json(), "S1")["cell_id"])["tray_id"]

    # A SPRQ run doesn't borrow the SPRQ-Nx tray's open cells - it opens its own SPRQ tray.
    sp = _place(client, "S2", tue, 0, cell_type="sprq")
    assert sp.status_code == 201, sp.text
    sp_cell = _cell(client, _stage_for(sp.json(), "S2")["cell_id"])
    assert sp_cell["cell_type"] == "sprq"
    assert sp_cell["tray_id"] != nx_tray

    # And a SPRQ-Nx run doesn't take the leftover SPRQ cells - it reuses the SPRQ-Nx tray.
    nx2 = _place(client, "S3", wed, 0)
    assert nx2.status_code == 201, nx2.text
    s3 = _stage_for(nx2.json(), "S3")
    assert s3["cell_type"] == "sprq_nx"
    assert _cell(client, s3["cell_id"])["tray_id"] == nx_tray


def test_asking_for_the_other_type_on_an_existing_run_is_refused(client):
    _import(client)
    (mon,) = _weekdays(1)

    assert _place(client, "S1", mon, 0, cell_type="sprq").status_code == 201
    r = _place(client, "S2", mon, 1, cell_type="sprq_nx")
    assert r.status_code == 409
    assert "can't mix cell types" in r.json()["detail"]


def test_an_explicit_cell_of_the_other_type_is_refused(client):
    _import(client)
    mon, tue = _weekdays(2)

    nx = _place(client, "S1", mon, 0)
    nx_tray = _cell(client, _stage_for(nx.json(), "S1")["cell_id"])["tray_id"]
    spare_nx = next(c for c in _tray_cells(client, nx_tray) if c["uses_consumed"] == 0)
    assert _place(client, "S2", tue, 0, cell_type="sprq").status_code == 201

    r = _place(client, "S3", tue, 1, cell_choice={"mode": "existing", "cell_id": spare_nx["id"]})
    assert r.status_code == 409
    assert "can't mix cell types" in r.json()["detail"]


def test_removing_a_sprq_placement_reopens_its_cell(client):
    """A SPRQ cell goes "exhausted" with its one use; losing that use must re-open it (its
    tray is still physically on the instrument), or the cell silently leaks."""
    _import(client)
    (mon,) = _weekdays(1)

    _place(client, "S1", mon, 0, cell_type="sprq")
    r = _place(client, "S2", mon, 1)
    s2 = _stage_for(r.json(), "S2")
    assert _cell(client, s2["cell_id"])["status"] == "exhausted"

    assert client.delete(f"/api/cell-uses/{s2['cell_use_id']}").status_code in (200, 204)
    cell = _cell(client, s2["cell_id"])
    assert cell["status"] == "open"
    assert cell["uses_consumed"] == 0


def test_a_sprq_sample_moved_to_an_empty_day_keeps_its_type(client):
    _import(client)
    mon, tue = _weekdays(2)

    r = _place(client, "S1", mon, 0, cell_type="sprq")
    s1 = _stage_for(r.json(), "S1")
    moved = client.post(
        f"/api/cell-uses/{s1['cell_use_id']}/move",
        json={"instrument_serial": "84047", "load_date": tue, "slot_index": 0, "run_time_hours": 24},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["cell_type"] == "sprq"
    assert _stage_for(moved.json(), "S1")["cell_type"] == "sprq"


def test_a_sample_moved_into_a_run_of_the_other_type_takes_that_runs_type(client):
    """Includes a same-well move (B01 -> B01 on another day), which would otherwise keep its
    own cell in place."""
    _import(client)
    mon, tue = _weekdays(2)

    _place(client, "S1", mon, 0)  # SPRQ-Nx run on Monday
    _place(client, "S2", tue, 0, cell_type="sprq")
    r = _place(client, "S3", tue, 1)
    s3 = _stage_for(r.json(), "S3")
    assert s3["cell_type"] == "sprq"

    moved = client.post(
        f"/api/cell-uses/{s3['cell_use_id']}/move",
        json={"instrument_serial": "84047", "load_date": mon, "slot_index": 1, "run_time_hours": 24},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["cell_type"] == "sprq_nx"
    assert _stage_for(moved.json(), "S3")["cell_type"] == "sprq_nx"
    # Its old SPRQ cell lost its only use, so it's open again for the next SPRQ drop.
    assert _cell(client, s3["cell_id"])["status"] == "open"


def test_auto_fill_never_uses_leftover_sprq_cells(client):
    _import(client)
    mon, tue = _weekdays(2)

    r = _place(client, "S1", mon, 0, cell_type="sprq")
    sprq_tray = _cell(client, _stage_for(r.json(), "S1")["cell_id"])["tray_id"]

    fill = client.post(
        "/api/auto-fill",
        json={
            "cells": [{"instrument_serial": "84047", "load_date": tue}],
            "objective": "fastest",
            "movie_times": [24],
            "max_uses": 3,
            "cells_per_day": 8,
        },
    )
    assert fill.status_code == 200, fill.text
    body = fill.json()
    assert body["placed_sample_ids"]
    assert {s["cell_type"] for run in body["runs"] for s in _stages(run)} == {"sprq_nx"}
    # The SPRQ tray's 3 leftover cells are untouched.
    leftovers = [c for c in _tray_cells(client, sprq_tray) if c["uses_consumed"] == 0]
    assert len(leftovers) == 3
    assert all(c["status"] == "open" for c in leftovers)


def test_auto_fill_skips_a_day_holding_a_sprq_run(client):
    _import(client)
    (mon,) = _weekdays(1)

    _place(client, "S1", mon, 0, cell_type="sprq")
    fill = client.post(
        "/api/auto-fill",
        json={
            "cells": [{"instrument_serial": "84047", "load_date": mon}],
            "objective": "fastest",
            "movie_times": [24],
            "max_uses": 3,
            "cells_per_day": 8,
        },
    )
    assert fill.status_code == 200, fill.text
    assert fill.json()["skipped_cells"] == [{"instrument_serial": "84047", "load_date": mon}]


def test_recalculate_leaves_sprq_runs_untouched(client):
    _import(client)
    mon, tue = _weekdays(2)

    r1 = _place(client, "S1", mon, 0, cell_type="sprq")
    r1 = _place(client, "S2", mon, 1)
    sprq_before = {s["cell_use_id"]: s["cell_id"] for s in _stages(r1.json())}
    _place(client, "S3", tue, 0)
    _place(client, "S4", tue, 1)

    rec = client.post("/api/auto-fill/recalculate", json={"instrument_serial": "84047"})
    assert rec.status_code == 200, rec.text
    body = rec.json()
    sprq_ids = {_sid(client, "S1"), _sid(client, "S2")}
    nx_ids = {_sid(client, "S3"), _sid(client, "S4")}
    assert nx_ids <= set(body["placed_sample_ids"])
    assert not sprq_ids & set(body["placed_sample_ids"])

    mon_run = client.get(f"/api/cycles/{r1.json()['run_id']}").json()
    assert {s["cell_use_id"]: s["cell_id"] for s in _stages(mon_run)} == sprq_before
    assert mon_run["cell_type"] == "sprq"


def test_recalculate_with_only_sprq_planned_is_a_no_op(client):
    _import(client)
    (mon,) = _weekdays(1)

    r = _place(client, "S1", mon, 0, cell_type="sprq")
    before = _stage_for(r.json(), "S1")
    rec = client.post("/api/auto-fill/recalculate", json={"instrument_serial": "84047"})
    assert rec.status_code == 200, rec.text
    assert rec.json()["placed_sample_ids"] == []
    after = _stage_for(client.get(f"/api/cycles/{r.json()['run_id']}").json(), "S1")
    assert (after["cell_use_id"], after["cell_id"]) == (before["cell_use_id"], before["cell_id"])


def test_discarding_a_sprq_tray_reloads_a_sprq_tray(client):
    _import(client)
    mon, tue = _weekdays(2)

    r1 = _place(client, "S1", mon, 0, cell_type="sprq")
    sprq_tray = _cell(client, _stage_for(r1.json(), "S1")["cell_id"])["tray_id"]
    r2 = _place(client, "S2", tue, 0, cell_type="sprq")  # takes a leftover cell of the same tray
    s2 = _stage_for(r2.json(), "S2")
    assert _cell(client, s2["cell_id"])["tray_id"] == sprq_tray

    resp = client.post("/api/cells/rotate-tray", json={"tray_id": sprq_tray, "from_date": mon})
    assert resp.status_code == 200, resp.text
    tue_run = client.get(f"/api/cycles/{r2.json()['run_id']}").json()
    moved = _stage_for(tue_run, "S2")
    new_cell = _cell(client, moved["cell_id"])
    assert new_cell["tray_id"] != sprq_tray
    assert new_cell["cell_type"] == "sprq"
    assert new_cell["max_uses"] == 1


def test_a_sprq_cell_has_no_108h_window(client, db_session):
    _import(client)
    (mon,) = _weekdays(1)

    r = _place(client, "S1", mon, 0, cell_type="sprq")
    cell_id = _stage_for(r.json(), "S1")["cell_id"]
    cell = db_session.get(Cell, cell_id)
    cell.first_use_started_at = utcnow() - timedelta(hours=200)
    recompute_status(cell)
    db_session.commit()

    out = _cell(client, cell_id)
    assert out["window_breached"] is False
    assert out["window_hours_elapsed"] is None
    assert out["status"] == "exhausted"  # spent by its one use, not expired


def test_batch_sheet_carries_the_cell_type(client):
    _import(client)
    (mon,) = _weekdays(1)

    _place(client, "S1", mon, 0, cell_type="sprq")
    sheet = client.get("/api/batch-sheet", params={"load_date": mon}).json()
    (run,) = sheet["runs"]
    assert run["cell_type"] == "sprq"
    (well,) = [w for p in run["plates"] for w in p["wells"]]
    assert well["cell_type"] == "sprq"
    assert well["cell_max_uses"] == 1
    assert well["cell_window_deadline"] is None


def test_stats_leave_sprq_cells_out_of_reuse_depth(client):
    _import(client)
    (mon,) = _weekdays(1)

    _place(client, "S1", mon, 0, cell_type="sprq")
    reuse = client.get("/api/stats").json()["reuse"]
    assert sum(s["cells"] for s in reuse["depth_distribution"]) == 0


def test_facts_report_both_use_caps(client):
    facts = client.get("/api/settings/facts").json()
    assert facts["cell_max_uses"] == 3
    assert facts["sprq_max_uses"] == 1
