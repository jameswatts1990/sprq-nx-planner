"""Interactive placement lifecycle: POST/DELETE /api/cell-uses, PATCH /api/cycles/{id}
status transitions (confirm + unlock reverse-cascade + transition-legality guard), and
POST /api/cycles/{id}/cancel."""
from datetime import date, timedelta


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


def _place(
    client, sample_id, run_date, slot_index, cell_choice=None, run_time_hours=24, instrument="84047", start_hour=None
):
    payload = {
        "sample_id": sample_id,
        "instrument_serial": instrument,
        "run_date": run_date,
        "slot_index": slot_index,
        "cell_choice": cell_choice or {"mode": "new"},
        "run_time_hours": run_time_hours,
        "max_uses": 3,
    }
    if start_hour is not None:
        payload["start_hour"] = start_hour
    return client.post("/api/cell-uses", json=payload)


def test_place_sample_happy_path_creates_run_and_schedules_sample(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)
    sid = _sid(client, "A1")

    resp = _place(client, sid, mon, 2)
    assert resp.status_code == 201, resp.text
    cycle = resp.json()
    assert cycle["instrument_serial"] == "84047"
    assert cycle["run_date"] == mon
    assert cycle["movie_hours"] == 24
    assert cycle["status"] == "planned"
    assert len(cycle["stages"]) == 1
    stage = cycle["stages"][0]
    assert stage["slot_index"] == 2
    assert stage["well"] == "C01"
    assert stage["sample_external_id"] == "A1"
    assert stage["barcodes"] == ["bc1"]

    # sample flips backlog -> scheduled
    assert client.get("/api/samples", params={"status": "backlog"}).json()["total"] == 0
    assert client.get("/api/samples", params={"status": "scheduled"}).json()["total"] == 1

    # cycle is now discoverable on the instrument calendar
    listed = client.get("/api/cycles", params={"instrument_serial": "84047"}).json()
    assert len(listed) == 1
    assert listed[0]["cycle_id"] == cycle["cycle_id"]


def test_place_sample_rejects_weekend(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    resp = _place(client, _sid(client, "A1"), _next_saturday(), 0)
    assert resp.status_code == 400
    assert "weekend" in resp.json()["detail"].lower()


def test_place_sample_rejects_barcode_conflict_on_existing_cell(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc1"})
    mon, tue = _weekdays(2)
    r1 = _place(client, _sid(client, "A1"), mon, 0)
    cell_id = r1.json()["stages"][0]["cell_id"]

    r2 = _place(client, _sid(client, "A2"), tue, 0, {"mode": "existing", "cell_id": cell_id})
    assert r2.status_code == 409
    assert "barcode" in r2.json()["detail"].lower()


def test_place_sample_rejects_well_collision(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "A1"), mon, 0)
    assert r1.status_code == 201, r1.text
    # same instrument+day+slot -> same well A01 already taken
    r2 = _place(client, _sid(client, "A2"), mon, 0)
    assert r2.status_code == 409
    assert "occupied" in r2.json()["detail"].lower()


def test_place_sample_rejects_movie_length_mismatch(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "A1"), mon, 0, run_time_hours=24)
    assert r1.status_code == 201, r1.text
    # a second placement into the same run demanding a different movie length is rejected
    r2 = _place(client, _sid(client, "A2"), mon, 1, run_time_hours=30)
    assert r2.status_code == 409
    assert "h" in r2.json()["detail"].lower()


def test_remove_sample_reverts_to_backlog_and_cleans_up_emptied_run(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)
    sid = _sid(client, "A1")
    r1 = _place(client, sid, mon, 0)
    cycle_id = r1.json()["cycle_id"]
    cell_use_id = r1.json()["stages"][0]["cell_use_id"]
    cell_id = r1.json()["stages"][0]["cell_id"]

    resp = client.delete(f"/api/cell-uses/{cell_use_id}")
    assert resp.status_code == 204

    # sample back to backlog
    assert client.get("/api/samples", params={"status": "backlog"}).json()["total"] == 1
    # the now-empty run+cycle was deleted
    assert client.get(f"/api/cycles/{cycle_id}").status_code == 404
    # the cell had no other uses, so it was only ever a placeholder for this one - it must
    # not be left behind as an "open, 0/3" cell that can never legitimately exist
    assert client.get(f"/api/cells/{cell_id}").status_code == 404


def test_remove_sample_keeps_cell_when_it_still_has_other_uses(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    mon, tue = _weekdays(2)
    a1, a2 = _sid(client, "A1"), _sid(client, "A2")

    r1 = _place(client, a1, mon, 0)
    cell_id = r1.json()["stages"][0]["cell_id"]
    # Monday's run (9am start, 24h movie) locks 84047 until Tue 15:00; clear it explicitly.
    r2 = _place(client, a2, tue, 0, {"mode": "existing", "cell_id": cell_id}, start_hour=15)
    assert r2.status_code == 201, r2.text
    cell_use_id_2 = r2.json()["stages"][0]["cell_use_id"]

    resp = client.delete(f"/api/cell-uses/{cell_use_id_2}")
    assert resp.status_code == 204

    # the cell still has its first use, so it must survive with the correct derived count
    cell = client.get(f"/api/cells/{cell_id}").json()
    assert cell["status"] == "open"
    assert cell["uses_consumed"] == 1


def test_patch_cycle_confirm_and_unlock_reverse_cascade(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)
    sid = _sid(client, "A1")
    r1 = _place(client, sid, mon, 0)
    cycle_id = r1.json()["cycle_id"]
    cell_id = r1.json()["stages"][0]["cell_id"]

    # confirm-load: planned -> running
    run = client.patch(f"/api/cycles/{cycle_id}", json={"status": "running"})
    assert run.status_code == 200, run.text
    assert run.json()["status"] == "running"
    assert run.json()["actual_start_at"] is not None
    assert client.get(f"/api/samples/{sid}").json()["status"] == "in_progress"
    assert client.get(f"/api/cells/{cell_id}").json()["first_use_started_at"] is not None

    # unlock: running -> planned reverses the cascade
    unlock = client.patch(f"/api/cycles/{cycle_id}", json={"status": "planned"})
    assert unlock.status_code == 200, unlock.text
    assert unlock.json()["status"] == "planned"
    assert unlock.json()["actual_start_at"] is None
    assert client.get(f"/api/samples/{sid}").json()["status"] == "scheduled"
    assert client.get(f"/api/cells/{cell_id}").json()["first_use_started_at"] is None


def test_patch_cycle_rejects_illegal_unlock_from_completed(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "A1"), mon, 0)
    cycle_id = r1.json()["cycle_id"]

    assert client.patch(f"/api/cycles/{cycle_id}", json={"status": "running"}).status_code == 200
    assert client.patch(f"/api/cycles/{cycle_id}", json={"status": "completed"}).status_code == 200

    # completed is terminal - reverting to planned must be rejected, not silently discard outcomes
    illegal = client.patch(f"/api/cycles/{cycle_id}", json={"status": "planned"})
    assert illegal.status_code == 409, illegal.text


def test_cancel_run_reverts_all_samples_and_deletes_run(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    (mon,) = _weekdays(1)
    a1, a2 = _sid(client, "A1"), _sid(client, "A2")
    r1 = _place(client, a1, mon, 0)
    cycle_id = r1.json()["cycle_id"]
    cell_id_1 = r1.json()["stages"][0]["cell_id"]
    r2 = _place(client, a2, mon, 1)
    cell_id_2 = r2.json()["stages"][0]["cell_id"]

    resp = client.post(f"/api/cycles/{cycle_id}/cancel")
    assert resp.status_code == 204

    assert client.get(f"/api/cycles/{cycle_id}").status_code == 404
    assert client.get("/api/samples", params={"status": "backlog"}).json()["total"] == 2
    # both cells were fresh placeholders for this now-cancelled run - neither should be left
    # behind as an "open, 0/3" cell
    assert client.get(f"/api/cells/{cell_id_1}").status_code == 404
    assert client.get(f"/api/cells/{cell_id_2}").status_code == 404


def test_cancel_run_rejected_when_not_planned(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "A1"), mon, 0)
    cycle_id = r1.json()["cycle_id"]
    client.patch(f"/api/cycles/{cycle_id}", json={"status": "running"})

    resp = client.post(f"/api/cycles/{cycle_id}/cancel")
    assert resp.status_code == 409
