"""Instruments management: maintenance-down flag (+ its scheduling guard), guarded delete,
and the per-instrument stats endpoint. Companion to test_cells_and_instruments_api.py, which
covers the pre-existing list/create/update."""
from datetime import date, timedelta


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


def _sid(client, external_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["external_id"] == external_id)


def _instrument_id(client, serial: str) -> int:
    return next(i for i in client.get("/api/instruments").json() if i["serial_number"] == serial)["id"]


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


def test_mark_instrument_down_and_back_online(client):
    iid = _instrument_id(client, "84047")
    mon = _weekdays(1)[0]

    down = client.post(f"/api/instruments/{iid}/maintenance", json={"down_from": mon, "note": "laser swap"})
    assert down.status_code == 200, down.text
    assert down.json()["down_from"] == mon
    assert down.json()["down_note"] == "laser swap"

    online = client.post(f"/api/instruments/{iid}/online")
    assert online.status_code == 200, online.text
    assert online.json()["down_from"] is None
    assert online.json()["down_note"] is None

    audit = client.get("/api/audit-log", params={"entity_type": "instrument", "entity_id": iid}).json()
    actions = {row["action"] for row in audit["items"]}
    assert {"instrument_down", "instrument_online"} <= actions


def test_down_instrument_refuses_new_run_from_the_down_date_but_allows_earlier(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    mon, _tue, wed = _weekdays(3)
    iid = _instrument_id(client, "84047")

    assert client.post(f"/api/instruments/{iid}/maintenance", json={"down_from": wed}).status_code == 200

    # A run loading before the down date is unaffected.
    before = _place(client, _sid(client, "A1"), mon, 0)
    assert before.status_code == 201, before.text

    # A brand-new run on the down date is refused with the maintenance message.
    blocked = _place(client, _sid(client, "A2"), wed, 0)
    assert blocked.status_code == 409, blocked.text
    assert "down for maintenance" in blocked.json()["detail"].lower()

    # Once back online, that same day loads fine (slot 4 = a different tray box from the
    # Monday run's, so this exercises the maintenance clearance, not a tray-box collision).
    assert client.post(f"/api/instruments/{iid}/online").status_code == 200
    now_ok = _place(client, _sid(client, "A2"), wed, 4)
    assert now_ok.status_code == 201, now_ok.text


def test_auto_fill_skips_a_down_instrument_and_fills_the_others(client):
    client.post(
        "/api/imports",
        json={"raw_text": "sample,barcodes\n" + "\n".join(f"X{i},bcx{i}" for i in range(1, 7))},
    )
    mon = _weekdays(1)[0]
    iid = _instrument_id(client, "84047")
    assert client.post(f"/api/instruments/{iid}/maintenance", json={"down_from": mon}).status_code == 200

    resp = client.post(
        "/api/auto-fill",
        json={
            "cells": [
                {"instrument_serial": "84047", "load_date": mon},
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
    assert len(body["runs"]) == 1
    assert body["runs"][0]["instrument_serial"] == "84098"


def test_delete_unused_instrument_succeeds_but_referenced_one_is_blocked(client):
    # A never-used instrument (added by mistake) hard-deletes cleanly.
    created = client.post("/api/instruments", json={"serial_number": "99999", "name": "Oops"})
    assert created.status_code == 201
    spare_id = created.json()["id"]
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
