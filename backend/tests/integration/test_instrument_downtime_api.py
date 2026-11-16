"""Instruments management: downtime periods (CRUD, overlap, end, the /maintenance + /online
shorthands, audit) and their scheduling gates (new runs refused on down days, reschedule, auto-fill
skip, affected runs listed not moved, a reuse Plate 2 acquiring on a down day flagged not blocked),
plus guarded delete and the per-instrument stats endpoint. Companion to
test_cells_and_instruments_api.py, which covers the pre-existing list/create/update."""
from datetime import UTC, date, datetime, timedelta


def _weekdays(n: int) -> list[str]:
    """The next n weekdays anchored at the next real Monday (never today), so they are
    genuinely consecutive business days with no hidden weekend gap."""
    d = date.today() + timedelta(days=1)
    while d.weekday() != 0:
        d += timedelta(days=1)
    out: list[str] = []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _utc_today() -> date:
    return datetime.now(UTC).date()


def _sid(client, pool_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["pool_id"] == pool_id)


def _instrument_id(client, serial: str) -> int:
    return next(i for i in client.get("/api/instruments").json() if i["serial_number"] == serial)["id"]


def _instrument(client, iid: int) -> dict:
    return next(i for i in client.get("/api/instruments").json() if i["id"] == iid)


def _place(client, sample_id, load_date, slot_index, instrument="84047"):
    return client.post(
        "/api/cell-uses",
        json={
            "sample_id": sample_id,
            "instrument_serial": instrument,
            "load_date": load_date,
            "slot_index": slot_index,
            "cell_choice": {"mode": "new"},
            "run_time_hours": 24,
            "max_uses": 3,
        },
    )


def _add(client, iid, start, end=None, kind="unplanned", note=None):
    return client.post(
        f"/api/instruments/{iid}/downtimes",
        json={"start_date": start, "end_date": end, "kind": kind, "note": note},
    )


def test_downtime_crud_end_and_audit(client):
    iid = _instrument_id(client, "84047")
    mon, tue, wed, thu, fri = _weekdays(5)

    created = _add(client, iid, mon, wed, "planned", "  Service visit  ")
    assert created.status_code == 201, created.text
    body = created.json()
    period = body["downtime"]
    assert (period["start_date"], period["end_date"], period["kind"], period["note"]) == (
        mon,
        wed,
        "planned",
        "Service visit",
    )
    assert body["affected_runs"] == []
    assert [d["id"] for d in body["instrument"]["downtimes"]] == [period["id"]]

    edited = client.put(
        f"/api/instruments/{iid}/downtimes/{period['id']}",
        json={"start_date": mon, "end_date": thu, "kind": "planned", "note": "Service visit"},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["downtime"]["end_date"] == thu

    # Back online on Wed -> the last down day is Tue.
    ended = client.post(f"/api/instruments/{iid}/downtimes/{period['id']}/end", json={"back_online_on": wed})
    assert ended.status_code == 200, ended.text
    assert ended.json()["downtime"]["end_date"] == tue

    # Ending one that hasn't started by then removes it.
    later = _add(client, iid, fri).json()["downtime"]
    gone = client.post(f"/api/instruments/{iid}/downtimes/{later['id']}/end", json={"back_online_on": fri})
    assert gone.status_code == 200, gone.text
    assert gone.json()["downtime"] is None
    assert len(gone.json()["instrument"]["downtimes"]) == 1

    assert client.delete(f"/api/instruments/{iid}/downtimes/{period['id']}").status_code == 204
    assert _instrument(client, iid)["downtimes"] == []

    audit = client.get("/api/audit-log", params={"entity_type": "instrument", "entity_id": iid}).json()
    actions = {row["action"] for row in audit["items"]}
    assert {
        "instrument_downtime_add",
        "instrument_downtime_update",
        "instrument_downtime_end",
        "instrument_downtime_delete",
    } <= actions


def test_downtime_validation_overlap_and_dates(client):
    iid = _instrument_id(client, "84047")
    days = _weekdays(10)
    mon, tue, wed, thu = days[:4]
    assert _add(client, iid, tue, wed).status_code == 201

    overlap = _add(client, iid, mon, tue)
    assert overlap.status_code == 409, overlap.text
    assert "overlaps" in overlap.json()["detail"]
    # Open-ended from before overlaps too; starting the day after doesn't.
    assert _add(client, iid, mon).status_code == 409
    assert _add(client, iid, thu, thu).status_code == 201

    backwards = _add(client, iid, days[9], days[8])
    assert backwards.status_code == 422, backwards.text

    # Another instrument's periods never clash.
    assert _add(client, _instrument_id(client, "84098"), tue, wed).status_code == 201


def test_future_downtime_is_not_down_now(client):
    """The old flag read Down as soon as any date was set; a future period must not."""
    iid = _instrument_id(client, "84047")
    today = _utc_today()
    soon = today + timedelta(days=3)
    assert _add(client, iid, soon.isoformat(), (soon + timedelta(days=1)).isoformat(), "planned").status_code == 201
    inst = _instrument(client, iid)
    assert inst["down_now"] is False
    assert inst["next_downtime"]["start_date"] == soon.isoformat()
    assert inst["down_from"] == soon.isoformat()  # derived from the next period

    since = today - timedelta(days=2)
    assert _add(client, iid, since.isoformat()).status_code == 409  # open-ended runs into the planned one
    assert _add(client, iid, since.isoformat(), today.isoformat(), note="Broke").status_code == 201
    inst = _instrument(client, iid)
    assert inst["down_now"] is True
    assert (inst["down_from"], inst["down_note"]) == (since.isoformat(), "Broke")


def test_maintenance_and_online_shorthands(client):
    iid = _instrument_id(client, "84047")
    today = _utc_today()

    down = client.post(
        f"/api/instruments/{iid}/maintenance", json={"down_from": today.isoformat(), "note": "laser swap"}
    )
    assert down.status_code == 200, down.text
    assert down.json()["down_now"] is True
    (period,) = down.json()["downtimes"]
    assert (period["end_date"], period["kind"], period["note"]) == (None, "unplanned", "laser swap")

    # Down today and back today: removed, rather than ending before it starts.
    online = client.post(f"/api/instruments/{iid}/online")
    assert online.status_code == 200, online.text
    assert online.json()["down_now"] is False
    assert online.json()["downtimes"] == []

    assert client.post(f"/api/instruments/{iid}/online").status_code == 409  # not down now

    # Down since an earlier day: Bring online keeps the history, ending it yesterday.
    since = today - timedelta(days=3)
    client.post(f"/api/instruments/{iid}/maintenance", json={"down_from": since.isoformat()})
    (kept,) = client.post(f"/api/instruments/{iid}/online").json()["downtimes"]
    assert kept["end_date"] == (today - timedelta(days=1)).isoformat()


def test_down_day_refuses_a_new_run_but_not_days_around_it(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2\nA3,bc3"})
    mon, tue, wed = _weekdays(3)
    iid = _instrument_id(client, "84047")
    assert _add(client, iid, tue, tue, "planned", "Engineer visit.").status_code == 201

    assert _place(client, _sid(client, "A1"), mon, 0).status_code == 201

    blocked = _place(client, _sid(client, "A2"), tue, 0)
    assert blocked.status_code == 409, blocked.text
    detail = blocked.json()["detail"]
    assert "down for maintenance" in detail.lower()
    assert "planned" in detail and "Engineer visit." in detail

    # The day after a closed period loads fine (slot 4 = a different tray from Monday's).
    assert _place(client, _sid(client, "A3"), wed, 4).status_code == 201


def test_reschedule_into_a_down_day_is_refused(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    mon, _tue, wed = _weekdays(3)
    run = _place(client, _sid(client, "A1"), mon, 0).json()
    iid = _instrument_id(client, "84047")
    assert _add(client, iid, wed).status_code == 201

    moved = client.post(f"/api/cycles/{run['run_id']}/reschedule", json={"new_load_date": wed})
    assert moved.status_code == 409, moved.text
    assert "down for maintenance" in moved.json()["detail"].lower()


def test_affected_runs_are_listed_and_left_in_place(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    mon, tue = _weekdays(2)
    run = _place(client, _sid(client, "A1"), tue, 0).json()
    iid = _instrument_id(client, "84047")

    resp = _add(client, iid, mon, tue, "planned")
    assert resp.status_code == 201, resp.text
    (affected,) = resp.json()["affected_runs"]
    assert (affected["run_id"], affected["load_date"], affected["plates"]) == (run["run_id"], tue, [1])

    runs = client.get("/api/cycles", params={"date_from": mon, "date_to": tue}).json()
    still = next(r for r in runs if r["run_id"] == run["run_id"])
    assert still["load_date"] == tue  # not moved
    assert still["plates"][0]["acquires_in_downtime"] is True


def test_reuse_plate2_acquiring_on_a_down_day_is_flagged_not_blocked(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    mon, tue = _weekdays(2)
    iid = _instrument_id(client, "84047")
    assert _place(client, _sid(client, "A1"), mon, 0).status_code == 201
    assert _add(client, iid, tue, tue).status_code == 201

    # A Plate-2 slot with no cell_choice derives the one-tray reuse, acquiring Tue (a down day).
    r = client.post(
        "/api/cell-uses",
        json={
            "sample_id": _sid(client, "A2"),
            "instrument_serial": "84047",
            "load_date": mon,
            "slot_index": 4,
            "run_time_hours": 24,
        },
    )
    assert r.status_code == 201, r.text
    plates = {p["plate_index"]: p for p in r.json()["plates"]}
    assert plates[2]["is_reuse"] is True and plates[2]["acquire_date"] == tue
    assert plates[2]["acquires_in_downtime"] is True
    assert plates[1]["acquires_in_downtime"] is False


def test_auto_fill_skips_only_the_down_days(client):
    client.post(
        "/api/imports",
        json={"raw_text": "sample,barcodes\n" + "\n".join(f"X{i},bcx{i}" for i in range(1, 7))},
    )
    mon, tue = _weekdays(2)
    iid = _instrument_id(client, "84047")
    assert _add(client, iid, mon, mon, "planned").status_code == 201

    resp = client.post(
        "/api/auto-fill",
        json={
            "cells": [
                {"instrument_serial": "84047", "load_date": mon},
                {"instrument_serial": "84047", "load_date": tue},
                {"instrument_serial": "84098", "load_date": mon},
            ],
            "objective": "fastest",
            "run_time_hours": 24,
            "max_uses": 3,
            "cells_per_day": 8,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["skipped_cells"] == [{"instrument_serial": "84047", "load_date": mon}]
    assert ("84047", mon) not in {(r["instrument_serial"], r["load_date"]) for r in body["runs"]}


def test_delete_unused_instrument_succeeds_but_referenced_one_is_blocked(client):
    # A never-used instrument (added by mistake) hard-deletes cleanly, downtime and all.
    created = client.post("/api/instruments", json={"serial_number": "99999", "name": "Oops"})
    assert created.status_code == 201
    spare_id = created.json()["id"]
    assert _add(client, spare_id, _weekdays(1)[0]).status_code == 201
    assert client.delete(f"/api/instruments/{spare_id}").status_code == 204
    assert "99999" not in {i["serial_number"] for i in client.get("/api/instruments").json()}

    # One with run/tray history is refused, pointing at 'mark inactive'.
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    mon = _weekdays(1)[0]
    assert _place(client, _sid(client, "A1"), mon, 0).status_code == 201
    used_id = _instrument_id(client, "84047")
    blocked = client.delete(f"/api/instruments/{used_id}")
    assert blocked.status_code == 409, blocked.text
    assert "inactive" in blocked.json()["detail"].lower()


def test_instrument_name_can_be_set_and_cleared(client):
    iid = _instrument_id(client, "84098")

    named = client.patch(f"/api/instruments/{iid}", json={"name": "Revio B"})
    assert named.status_code == 200
    assert named.json()["name"] == "Revio B"

    # Blank/whitespace clears the name back to NULL (so the Schedule shows the serial again).
    cleared = client.patch(f"/api/instruments/{iid}", json={"name": "  "})
    assert cleared.status_code == 200
    assert cleared.json()["name"] is None


def test_instrument_stats_reports_runs_trays_and_cells(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    mon = _weekdays(1)[0]
    assert _place(client, _sid(client, "A1"), mon, 0).status_code == 201

    stats = client.get("/api/instruments/stats")
    assert stats.status_code == 200, stats.text
    by_serial = {row["serial_number"]: row for row in stats.json()}

    used = by_serial["84047"]
    assert used["total_runs"] == 1
    assert used["last_run_date"] == mon
    assert used["next_run_date"] == mon  # planned run, load date in the future
    assert used["open_tray_count"] == 1
    assert used["cell_total_count"] == 4  # opening a tray creates all 4 sibling cells
    assert used["cell_open_count"] == 4

    idle = by_serial["84309"]
    assert idle["total_runs"] == 0
    assert idle["open_tray_count"] == 0
    assert idle["cell_total_count"] == 0
