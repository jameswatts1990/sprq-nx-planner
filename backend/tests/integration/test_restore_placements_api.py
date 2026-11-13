"""Undo for schedule edits (roadmap C2): bulk-remove returns a snapshot, POST /api/cell-uses/restore
puts it back in one all-or-nothing transaction, and a move / swap is undone by a guarded move back /
swap again. A restore prefers each sample's original cell but must never break a scheduling
invariant to keep it - see docs/pacbio-sprq-nx-scheduling-reference.md "Undo / restore"."""
from datetime import date, timedelta

from sqlalchemy import select

from app.models.audit import AuditLog
from app.models.schedule import RunBatch

SERIAL = "84047"


def _monday(weeks_ahead: int = 1) -> date:
    d = date.today() + timedelta(days=1)
    while d.weekday() != 0:
        d += timedelta(days=1)
    return d + timedelta(weeks=weeks_ahead - 1)


def _import(client, names: list[str]) -> None:
    raw = "sample,barcodes\n" + "\n".join(f"{n},bc{n}" for n in names)
    assert client.post("/api/imports", json={"raw_text": raw}).status_code in (200, 201)


def _sid(client, pool_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["pool_id"] == pool_id)


def _place(client, name: str, day: date, slot: int, cell_choice: dict | None = None, start_hour: int | None = None):
    body = {"sample_id": _sid(client, name), "instrument_serial": SERIAL, "load_date": day.isoformat(), "slot_index": slot}
    if cell_choice is not None:
        body["cell_choice"] = cell_choice
    if start_hour is not None:
        body["start_hour"] = start_hour
    r = client.post("/api/cell-uses", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _stages(run: dict) -> list[dict]:
    return [dict(s, plate_index=p["plate_index"]) for p in run["plates"] for s in p["stages"]]


def _stage_of(run: dict, name: str) -> dict:
    return next(s for s in _stages(run) if s["sample_pool_id"] == name)


def _remove(client, *cell_use_ids: int) -> list[dict]:
    r = client.post("/api/cell-uses/bulk-remove", json={"cell_use_ids": list(cell_use_ids)})
    assert r.status_code == 200, r.text
    assert r.json()["removed_count"] == len(cell_use_ids)
    return r.json()["snapshot"]


def _restore(client, snapshot: list[dict]):
    return client.post("/api/cell-uses/restore", json={"items": snapshot})


def _run_on(client, day: date) -> dict | None:
    runs = client.get("/api/cycles", params={"date_from": day.isoformat(), "date_to": day.isoformat()}).json()
    return next((r for r in runs if r["instrument_serial"] == SERIAL and r["load_date"] == day.isoformat()), None)


def _status(client, name: str) -> str:
    return client.get(f"/api/samples/{_sid(client, name)}").json()["status"]


def _confirm(client, run_id: int, day: date) -> None:
    r = client.patch(f"/api/cycles/{run_id}", json={"status": "running", "at": f"{day.isoformat()}T12:00:00Z"})
    assert r.status_code == 200, r.text


# --- round trips ----------------------------------------------------------------------------


def test_remove_then_restore_puts_everything_back(client):
    _import(client, ["S1", "S2", "S3"])
    mon = _monday()
    _place(client, "S1", mon, 0)
    _place(client, "S2", mon, 1)
    run = _place(client, "S3", mon, 2)
    before = {s["sample_pool_id"]: s for s in _stages(run)}
    s2 = before["S2"]
    assert client.patch(f"/api/cell-uses/{s2['cell_use_id']}/notes", json={"notes": "dilute 2x"}).status_code == 200
    assert client.patch(f"/api/cell-uses/{s2['cell_use_id']}/run-time", json={"run_time_hours": 30}).status_code == 200

    snapshot = _remove(client, s2["cell_use_id"])
    assert snapshot[0]["notes"] == "dilute 2x" and snapshot[0]["run_time_hours"] == 30
    assert _status(client, "S2") == "backlog"

    resp = _restore(client, snapshot)
    assert resp.status_code == 200, resp.text
    [restored] = resp.json()["restored"]
    assert restored["cell_changed"] is False
    after = _stage_of(_run_on(client, mon), "S2")
    assert (after["slot_index"], after["cell_id"], after["run_time_hours"]) == (s2["slot_index"], s2["cell_id"], 30)
    assert client.get(f"/api/cell-uses/{after['cell_use_id']}").json()["notes"] == "dilute 2x"
    assert _status(client, "S2") == "scheduled"
    assert {s["sample_pool_id"]: s["cell_id"] for s in _stages(_run_on(client, mon))} == {
        k: v["cell_id"] for k, v in before.items()
    }


def test_restore_recreates_a_deleted_run_with_its_start_time_and_name(client, db_session):
    _import(client, ["S1"])
    tue = _monday() + timedelta(days=1)
    run = _place(client, "S1", tue, 0, start_hour=14)
    rb = db_session.get(RunBatch, run["run_id"])
    rb.run_name = "TRAC-42"
    db_session.commit()

    snapshot = _remove(client, _stages(run)[0]["cell_use_id"])
    assert _run_on(client, tue) is None  # the run went with its only sample

    assert _restore(client, snapshot).status_code == 200
    again = _run_on(client, tue)
    assert again["run_name"] == "TRAC-42"
    assert again["plates"][0]["planned_start_at"].startswith(f"{tue.isoformat()}T14:00")


def test_a_deleted_tray_comes_back_as_a_tray_and_reports_any_new_cell(client):
    _import(client, ["S1", "S2"])
    mon = _monday()
    _place(client, "S1", mon, 0)
    run = _place(client, "S2", mon, 1)
    snapshot = _remove(client, *(s["cell_use_id"] for s in _stages(run)))  # tray had no other uses: deleted

    resp = _restore(client, snapshot)
    assert resp.status_code == 200, resp.text
    restored = resp.json()["restored"]
    for r in restored:
        # A recreated tray may reuse the old code on SQLite (ids are reused); either way the flag
        # says exactly whether the user sees a different cell.
        assert r["cell_changed"] == (r["to_cell_code"] != r["from_cell_code"])
    stages = _stages(_run_on(client, mon))
    assert len({s["tray_id"] for s in stages}) == 1  # one tray, not one per restored sample
    assert sorted(s["slot_index"] for s in stages) == [0, 1]


def test_a_use_1_2_3_chain_restores_in_order_on_one_cell(client):
    _import(client, ["U1", "U2", "U3"])
    mon = _monday()
    r1 = _place(client, "U1", mon, 0)
    cell = _stages(r1)[0]["cell_id"]
    r2 = _place(client, "U2", mon + timedelta(days=1), 0)
    r3 = _place(client, "U3", mon + timedelta(days=2), 0)
    assert _stages(r2)[0]["cell_id"] == cell == _stages(r3)[0]["cell_id"]

    # Snapshot order is the reverse of time order - restore must sort it.
    snapshot = _remove(client, _stages(r3)[0]["cell_use_id"], _stages(r2)[0]["cell_use_id"], _stages(r1)[0]["cell_use_id"])
    resp = _restore(client, snapshot)
    assert resp.status_code == 200, resp.text
    assert not any(r["cell_changed"] for r in resp.json()["restored"])
    for i, day in enumerate((mon, mon + timedelta(days=1), mon + timedelta(days=2))):
        stage = _stages(_run_on(client, day))[0]
        assert stage["cell_id"] == cell
        assert stage["use_number"] == i + 1


def test_a_reuse_plate_2_restores_after_its_plate_1(client):
    _import(client, ["P1", "P2"])
    mon = _monday()
    _place(client, "P1", mon, 0)
    run = _place(client, "P2", mon, 4)  # Plate 2 reusing Plate 1's cell, acquiring a later day
    plate2 = next(p for p in run["plates"] if p["plate_index"] == 2)
    assert plate2["acquire_date"] > mon.isoformat()
    before = {s["sample_pool_id"]: (s["cell_id"], s["plate_index"]) for s in _stages(run)}

    snapshot = _remove(client, *(s["cell_use_id"] for s in reversed(_stages(run))))
    assert _restore(client, snapshot).status_code == 200
    again = _run_on(client, mon)
    assert {s["sample_pool_id"]: (s["cell_id"], s["plate_index"]) for s in _stages(again)} == before
    assert next(p for p in again["plates"] if p["plate_index"] == 2)["acquire_date"] == plate2["acquire_date"]


def test_restore_writes_a_restore_sample_audit_row(client, db_session):
    _import(client, ["S1"])
    run = _place(client, "S1", _monday(), 0)
    snapshot = _remove(client, _stages(run)[0]["cell_use_id"])
    assert _restore(client, snapshot).status_code == 200
    rows = db_session.scalars(select(AuditLog).where(AuditLog.action == "restore_sample")).all()
    assert len(rows) == 1 and rows[0].details_json["sample_id"] == _sid(client, "S1")


# --- refused up front: nothing restored -----------------------------------------------------


def test_a_sample_scheduled_again_since_refuses_the_whole_restore(client):
    _import(client, ["S1", "S2"])
    mon = _monday()
    _place(client, "S1", mon, 0)
    run = _place(client, "S2", mon, 1)
    snapshot = _remove(client, *(s["cell_use_id"] for s in _stages(run)))
    _place(client, "S2", mon + timedelta(days=2), 0)  # S2 re-placed elsewhere since

    resp = _restore(client, snapshot)
    assert resp.status_code == 409
    assert "S2" in resp.json()["detail"]
    assert _status(client, "S1") == "backlog"  # all or nothing
    assert _run_on(client, mon) is None


def test_an_occupied_well_refuses_the_restore(client):
    _import(client, ["S1", "S2", "X"])
    mon = _monday()
    _place(client, "S1", mon, 0)
    run = _place(client, "S2", mon, 1)
    snapshot = _remove(client, _stage_of(run, "S2")["cell_use_id"])
    _place(client, "X", mon, 1)  # someone filled the well

    resp = _restore(client, snapshot)
    assert resp.status_code == 409
    assert "filled since" in resp.json()["detail"]
    assert _status(client, "S2") == "backlog"


def test_a_run_loaded_since_refuses_the_restore(client):
    _import(client, ["S1", "S2"])
    mon = _monday()
    _place(client, "S1", mon, 0)
    run = _place(client, "S2", mon, 1)
    snapshot = _remove(client, _stage_of(run, "S2")["cell_use_id"])
    _confirm(client, run["run_id"], mon)

    resp = _restore(client, snapshot)
    assert resp.status_code == 409
    assert "loaded since" in resp.json()["detail"]


# --- the original cell is kept only when every invariant allows it ---------------------------


def test_restore_never_puts_a_cell_on_a_day_it_already_runs(client):
    _import(client, ["M1", "M2", "T1", "P2"])
    mon, tue = _monday(), _monday() + timedelta(days=1)
    _place(client, "M1", mon, 0)
    _place(client, "M2", mon, 1)
    tue_run = _place(client, "T1", tue, 0)  # cross-run reuse of Monday's first cell on Tuesday
    cell_a = _stages(tue_run)[0]["cell_id"]
    snapshot = _remove(client, _stages(tue_run)[0]["cell_use_id"])
    # Monday's reuse Plate 2 now takes cell A on Tuesday.
    p2 = _stage_of(_place(client, "P2", mon, 4), "P2")
    assert p2["cell_id"] == cell_a

    resp = _restore(client, snapshot)
    assert resp.status_code == 200, resp.text
    [restored] = resp.json()["restored"]
    assert restored["cell_changed"] is True
    assert _stages(_run_on(client, tue))[0]["cell_id"] != cell_a


def test_restore_never_puts_a_use_ahead_of_a_started_one(client):
    _import(client, ["F1", "M1"])
    mon = _monday(2)
    fri = mon - timedelta(days=3)
    fri_run = _place(client, "F1", fri, 0)
    cell_a = _stages(fri_run)[0]["cell_id"]
    mon_run = _place(client, "M1", mon, 0)
    assert _stages(mon_run)[0]["cell_id"] == cell_a
    snapshot = _remove(client, _stages(fri_run)[0]["cell_use_id"])
    _confirm(client, mon_run["run_id"], mon)  # Monday's use of cell A has started

    resp = _restore(client, snapshot)
    assert resp.status_code == 200, resp.text
    assert resp.json()["restored"][0]["cell_changed"] is True
    assert _stages(_run_on(client, fri))[0]["cell_id"] != cell_a


def test_restore_never_pushes_a_booked_use_out_of_its_108h_window(client):
    _import(client, ["E1", "W1", "F1"])
    mon = _monday()
    mon_run = _place(client, "E1", mon, 0, start_hour=0)
    cell_a = _stages(mon_run)[0]["cell_id"]
    _place(client, "W1", mon + timedelta(days=2), 0, {"mode": "existing", "cell_id": cell_a}, start_hour=12)
    snapshot = _remove(client, _stages(mon_run)[0]["cell_use_id"])
    # With Wednesday 12:00 as Use 1, a Friday 14:00 use is in window (deadline Sunday 24:00) ...
    _place(client, "F1", mon + timedelta(days=4), 0, {"mode": "existing", "cell_id": cell_a}, start_hour=14)

    # ... but restoring Monday 00:00 onto cell A would pull the deadline to Friday 12:00 and strand it.
    resp = _restore(client, snapshot)
    assert resp.status_code == 200, resp.text
    assert resp.json()["restored"][0]["cell_changed"] is True
    assert _stages(_run_on(client, mon))[0]["cell_id"] != cell_a


# --- undo a move / swap -----------------------------------------------------------------------


def _move(client, cell_use_id: int, day: date, slot: int, **extra):
    body = {"instrument_serial": SERIAL, "load_date": day.isoformat(), "slot_index": slot, "run_time_hours": 24, **extra}
    return client.post(f"/api/cell-uses/{cell_use_id}/move", json=body)


def test_undo_a_move_goes_back_to_the_original_cell(client):
    _import(client, ["S1", "S2"])
    mon, wed = _monday(), _monday() + timedelta(days=2)
    _place(client, "S1", mon, 0)
    run = _place(client, "S2", mon, 1)
    orig = _stage_of(run, "S2")
    assert client.patch(f"/api/cell-uses/{orig['cell_use_id']}/notes", json={"notes": "keep cold"}).status_code == 200

    moved = _move(client, orig["cell_use_id"], wed, 2)
    assert moved.status_code == 200, moved.text
    now = _stage_of(moved.json(), "S2")

    back = _move(
        client,
        now["cell_use_id"],
        mon,
        orig["slot_index"],
        expected_sample_id=orig["sample_id"],
        prefer_cell_id=orig["cell_id"],
        prefer_cell_code=orig["cell_ref"],
    )
    assert back.status_code == 200, back.text
    again = _stage_of(back.json(), "S2")
    assert (again["slot_index"], again["cell_id"]) == (orig["slot_index"], orig["cell_id"])
    assert client.get(f"/api/cell-uses/{again['cell_use_id']}").json()["notes"] == "keep cold"


def test_undo_a_move_refuses_when_the_placement_changed_since(client):
    _import(client, ["S1", "S2"])
    mon = _monday()
    run = _place(client, "S1", mon, 0)
    _place(client, "S2", mon, 1)
    s1 = _stage_of(run, "S1")
    resp = _move(client, s1["cell_use_id"], mon, 3, expected_sample_id=_sid(client, "S2"))
    assert resp.status_code == 409
    assert "changed since" in resp.json()["detail"]


def test_undo_a_swap_is_a_guarded_swap_back(client):
    _import(client, ["S1", "S2"])
    mon = _monday()
    _place(client, "S1", mon, 0)
    run = _place(client, "S2", mon, 1)
    a, b = _stage_of(run, "S1"), _stage_of(run, "S2")
    assert client.post(f"/api/cell-uses/{a['cell_use_id']}/swap", json={"other_cell_use_id": b["cell_use_id"]}).status_code == 200

    stale = client.post(
        f"/api/cell-uses/{a['cell_use_id']}/swap",
        json={"other_cell_use_id": b["cell_use_id"], "expected_sample_id": a["sample_id"], "expected_other_sample_id": b["sample_id"]},
    )
    assert stale.status_code == 409  # a now holds S2, not S1

    undo = client.post(
        f"/api/cell-uses/{a['cell_use_id']}/swap",
        json={"other_cell_use_id": b["cell_use_id"], "expected_sample_id": b["sample_id"], "expected_other_sample_id": a["sample_id"]},
    )
    assert undo.status_code == 200, undo.text
    assert _stage_of(_run_on(client, mon), "S1")["cell_use_id"] == a["cell_use_id"]
