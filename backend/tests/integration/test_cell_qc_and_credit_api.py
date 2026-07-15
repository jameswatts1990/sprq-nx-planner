"""QC workflow: flagging a cell-use Failed (this use only, cell stays open) or a whole
Cell Stopped (all future uses lost, cascades planned uses back to backlog and excludes
the cell from all future reuse), plus the PacBio credit-tracking workflow (report ->
confirm -> receive) and its unreported/awaiting-credit list filters."""
from datetime import date, timedelta


def _weekdays(n: int) -> list[str]:
    out: list[str] = []
    d = date.today()
    while len(out) < n:
        d += timedelta(days=1)
        if d.weekday() < 5:
            out.append(d.isoformat())
    return out


def _sid(client, external_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["external_id"] == external_id)


def _sample(client, sample_id: int) -> dict:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s for s in items if s["id"] == sample_id)


def _place(client, sample_id, run_date, slot_index, cell_choice, run_time_hours=24, instrument="84047", start_hour=None):
    payload = {
        "sample_id": sample_id,
        "instrument_serial": instrument,
        "run_date": run_date,
        "slot_index": slot_index,
        "cell_choice": cell_choice,
        "run_time_hours": run_time_hours,
        "max_uses": 3,
    }
    if start_hour is not None:
        payload["start_hour"] = start_hour
    return client.post("/api/cell-uses", json=payload)


def test_mark_cell_use_failed_keeps_cell_open_and_sample_can_be_requeued(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nF1,bcf1"})
    (mon,) = _weekdays(1)

    r1 = _place(client, _sid(client, "F1"), mon, 0, {"mode": "new"})
    assert r1.status_code == 201, r1.text
    stage = r1.json()["stages"][0]

    resp = client.patch(f"/api/cell-uses/{stage['cell_use_id']}", json={"status": "failed", "notes": "no data produced"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "failed"
    assert resp.json()["outcome_notes"] == "no data produced"

    f1 = _sample(client, _sid(client, "F1"))
    assert f1["status"] == "failed"

    # cell stays open (1 of 3 uses consumed, capacity remains) - Failed doesn't stop it
    cell = client.get(f"/api/cells/{stage['cell_id']}").json()
    assert cell["status"] == "open"
    assert cell["uses_consumed"] == 1
    assert cell["has_failed_use"] is True
    assert cell["needs_qc_report"] is True

    requeued = client.post(f"/api/samples/{f1['id']}/requeue")
    assert requeued.status_code == 200, requeued.text
    assert requeued.json()["status"] == "backlog"


def test_stop_cell_cascades_planned_future_use_back_to_backlog_and_excludes_from_reuse(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nG1,bcg1\nG2,bcg2\nG3,bcg3"})
    mon, _tue, wed = _weekdays(3)

    r1 = _place(client, _sid(client, "G1"), mon, 0, {"mode": "new"})
    assert r1.status_code == 201, r1.text
    cell_id = r1.json()["stages"][0]["cell_id"]
    cycle1_id = r1.json()["cycle_id"]

    # confirm Monday's run loaded and complete it - Use 1 becomes real, untouchable history
    assert client.patch(f"/api/cycles/{cycle1_id}", json={"status": "running"}).status_code == 200
    assert client.patch(f"/api/cycles/{cycle1_id}", json={"status": "completed"}).status_code == 200

    # G2 reuses the same physical cell for a still-planned Use 2 on Wednesday
    r2 = _place(client, _sid(client, "G2"), wed, 0, {"mode": "existing", "cell_id": cell_id})
    assert r2.status_code == 201, r2.text
    cycle2_id = r2.json()["cycle_id"]
    g2_id = _sid(client, "G2")

    stop = client.post(f"/api/cells/{cell_id}/stop", json={"reason": "visible crack on tray"})
    assert stop.status_code == 200, stop.text
    body = stop.json()
    assert body["bumped_sample_ids"] == [g2_id]
    assert body["cell"]["status"] == "stopped"
    assert body["cell"]["stopped_reason"] == "visible crack on tray"

    # G2 is back in backlog for rescheduling
    assert _sample(client, g2_id)["status"] == "backlog"

    # Wednesday's cycle was the cell's only stage there - cleaned up, same as remove_sample
    assert client.get(f"/api/cycles/{cycle2_id}").status_code == 404

    # Monday's completed Use 1 is untouched history
    mon_cycle = client.get(f"/api/cycles/{cycle1_id}").json()
    assert mon_cycle["status"] == "completed"
    assert mon_cycle["stages"][0]["sample_external_id"] == "G1"

    # excluded from all future reuse: an explicit re-placement onto the stopped cell is rejected
    reuse_attempt = _place(client, _sid(client, "G3"), wed, 1, {"mode": "existing", "cell_id": cell_id})
    assert reuse_attempt.status_code == 409
    assert "not open" in reuse_attempt.json()["detail"].lower()


def test_stop_cell_rejects_double_stop_and_already_retired(client):
    boot = client.post("/api/cells/bootstrap", json={"max_uses": 3, "uses_consumed": 0, "burned_barcodes": []})
    cell_id = boot.json()["id"]

    first = client.post(f"/api/cells/{cell_id}/stop", json={"reason": "damaged"})
    assert first.status_code == 200, first.text

    again = client.post(f"/api/cells/{cell_id}/stop", json={"reason": "damaged again"})
    assert again.status_code == 409

    other = client.post("/api/cells/bootstrap", json={"max_uses": 3, "uses_consumed": 0, "burned_barcodes": []})
    retired_id = other.json()["id"]
    assert client.post(f"/api/cells/{retired_id}/retire").status_code == 200
    stop_retired = client.post(f"/api/cells/{retired_id}/stop", json={"reason": "damaged"})
    assert stop_retired.status_code == 409


def test_stopped_cell_status_is_sticky_against_later_cell_use_updates(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nH1,bch1"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "H1"), mon, 0, {"mode": "new"})
    assert r1.status_code == 201, r1.text
    stage = r1.json()["stages"][0]
    cycle_id = r1.json()["cycle_id"]

    client.patch(f"/api/cycles/{cycle_id}", json={"status": "running"})
    client.patch(f"/api/cycles/{cycle_id}", json={"status": "completed"})

    stop = client.post(f"/api/cells/{stage['cell_id']}/stop", json={"reason": "damaged after Use 1"})
    assert stop.status_code == 200, stop.text
    assert stop.json()["cell"]["status"] == "stopped"

    # amending the already-completed use's notes still recomputes the cell's status -
    # it must stay "stopped", never fall back to "open"/"exhausted"
    amend = client.patch(f"/api/cell-uses/{stage['cell_use_id']}", json={"status": "completed", "notes": "amended"})
    assert amend.status_code == 200, amend.text

    cell = client.get(f"/api/cells/{stage['cell_id']}").json()
    assert cell["status"] == "stopped"


def test_credit_workflow_guards_out_of_order_actions(client):
    boot = client.post("/api/cells/bootstrap", json={"max_uses": 3, "uses_consumed": 0, "burned_barcodes": []})
    cell_id = boot.json()["id"]

    # not eligible yet - no failed use, not stopped
    not_eligible = client.post(f"/api/cells/{cell_id}/report-to-pacbio", json={"case_number": "CASE-1"})
    assert not_eligible.status_code == 409

    assert client.post(f"/api/cells/{cell_id}/stop", json={"reason": "damaged"}).status_code == 200

    # confirm/receive before reporting - both rejected
    assert client.post(f"/api/cells/{cell_id}/confirm-credit", json={}).status_code == 409
    assert client.post(f"/api/cells/{cell_id}/receive-credit", json={}).status_code == 409

    report = client.post(f"/api/cells/{cell_id}/report-to-pacbio", json={"case_number": "CASE-1"})
    assert report.status_code == 200, report.text
    assert report.json()["pacbio_case_number"] == "CASE-1"
    assert report.json()["needs_qc_report"] is False
    assert report.json()["awaiting_credit"] is True


def test_credit_workflow_happy_path_and_qc_status_filters(client):
    boot = client.post("/api/cells/bootstrap", json={"max_uses": 3, "uses_consumed": 0, "burned_barcodes": []})
    cell_id = boot.json()["id"]
    assert client.post(f"/api/cells/{cell_id}/stop", json={"reason": "damaged"}).status_code == 200

    unreported = client.get("/api/cells", params={"qc_status": "unreported"}).json()
    assert cell_id in [c["id"] for c in unreported["items"]]

    assert (
        client.post(f"/api/cells/{cell_id}/report-to-pacbio", json={"case_number": "CASE-42"}).status_code == 200
    )

    unreported_after = client.get("/api/cells", params={"qc_status": "unreported"}).json()
    assert cell_id not in [c["id"] for c in unreported_after["items"]]

    awaiting = client.get("/api/cells", params={"qc_status": "awaiting_credit"}).json()
    assert cell_id in [c["id"] for c in awaiting["items"]]

    confirm = client.post(f"/api/cells/{cell_id}/confirm-credit", json={})
    assert confirm.status_code == 200, confirm.text
    assert confirm.json()["pacbio_credit_confirmed_at"] is not None

    receive = client.post(f"/api/cells/{cell_id}/receive-credit", json={})
    assert receive.status_code == 200, receive.text
    assert receive.json()["credit_received_at"] is not None

    awaiting_after = client.get("/api/cells", params={"qc_status": "awaiting_credit"}).json()
    assert cell_id not in [c["id"] for c in awaiting_after["items"]]


def test_unknown_qc_status_filter_is_rejected(client):
    resp = client.get("/api/cells", params={"qc_status": "bogus"})
    assert resp.status_code == 400
