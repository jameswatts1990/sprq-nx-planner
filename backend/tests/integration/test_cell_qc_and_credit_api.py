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


def _past_weekday() -> str:
    d = date.today() - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d.isoformat()


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
    past = _past_weekday()

    r1 = _place(client, _sid(client, "F1"), past, 0, {"mode": "new"})
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

    # G2 reuses the same physical cell (same well - cells stay pinned to it) for a
    # still-planned Use 2 on Wednesday
    r2 = _place(client, _sid(client, "G2"), wed, 0, {"mode": "existing", "cell_id": cell_id})
    assert r2.status_code == 201, r2.text
    cycle2_id = r2.json()["cycle_id"]
    g2_use_id = r2.json()["stages"][0]["cell_use_id"]
    g2_id = _sid(client, "G2")

    stop = client.post(f"/api/cells/{cell_id}/stop", json={"reason": "visible crack on tray"})
    assert stop.status_code == 200, stop.text
    body = stop.json()
    assert body["bumped_sample_ids"] == [g2_id]
    assert body["cell"]["status"] == "stopped"
    assert body["cell"]["stopped_reason"] == "visible crack on tray"

    # G2 is back in backlog for rescheduling
    assert _sample(client, g2_id)["status"] == "backlog"

    # Wednesday's cycle/stage stay visible as a cancelled, blocked record - not deleted -
    # so the grid never silently loses a placement without a trace
    wed_cycle = client.get(f"/api/cycles/{cycle2_id}").json()
    wed_stage = next(s for s in wed_cycle["stages"] if s["cell_use_id"] == g2_use_id)
    assert wed_stage["cell_use_status"] == "cancelled"
    assert wed_stage["cell_status"] == "stopped"
    assert wed_stage["sample_external_id"] == "G2"

    # ...and that well can never be filled by anything else again
    reblock_attempt = _place(client, _sid(client, "G3"), wed, 0, {"mode": "new"})
    assert reblock_attempt.status_code == 409
    assert "already occupied" in reblock_attempt.json()["detail"].lower()

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


def test_mark_failed_available_once_run_locked_even_before_confirmed_loaded(client):
    """The instrument commits to a run (and a physical cell failure becomes possible) at
    its scheduled start time, not only once someone clicks "Confirm loaded" - so a still-
    "planned" use whose run's start time has already passed must already be QC-able,
    while a genuinely future use must not be."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nP1,bcp1\nP2,bcp2"})
    past = _past_weekday()
    future = _weekdays(3)[-1]

    r_past = _place(client, _sid(client, "P1"), past, 0, {"mode": "new"}, instrument="84093")
    assert r_past.status_code == 201, r_past.text
    past_stage = r_past.json()["stages"][0]

    r_future = _place(client, _sid(client, "P2"), future, 0, {"mode": "new"}, instrument="84309")
    assert r_future.status_code == 201, r_future.text
    future_stage = r_future.json()["stages"][0]

    past_detail = client.get(f"/api/cells/{past_stage['cell_id']}").json()
    past_use = next(u for u in past_detail["use_history"] if u["id"] == past_stage["cell_use_id"])
    assert past_use["status"] == "planned"
    assert past_use["run_started"] is True

    future_detail = client.get(f"/api/cells/{future_stage['cell_id']}").json()
    future_use = next(u for u in future_detail["use_history"] if u["id"] == future_stage["cell_use_id"])
    assert future_use["status"] == "planned"
    assert future_use["run_started"] is False

    # QC is already actionable on the past (locked) run even though nobody confirmed loading
    fail = client.patch(
        f"/api/cell-uses/{past_stage['cell_use_id']}", json={"status": "failed", "notes": "found dead cell on load"}
    )
    assert fail.status_code == 200, fail.text
    assert fail.json()["status"] == "failed"


def test_mark_failed_and_aborted_rejected_before_run_has_started(client):
    """Server-side mirror of the frontend's canRecordQcOutcome gate (cellUseQc.ts) - a
    direct API call must not be able to record a QC outcome on a use whose run hasn't
    reached its scheduled start time yet, even though the UI itself already hides the
    buttons for this case."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nP3,bcp3"})
    future = _weekdays(3)[-1]

    r1 = _place(client, _sid(client, "P3"), future, 0, {"mode": "new"}, instrument="84093")
    assert r1.status_code == 201, r1.text
    use_id = r1.json()["stages"][0]["cell_use_id"]

    fail = client.patch(f"/api/cell-uses/{use_id}", json={"status": "failed", "notes": "too early"})
    assert fail.status_code == 409, fail.text
    assert "started" in fail.json()["detail"].lower()

    abort = client.patch(f"/api/cell-uses/{use_id}", json={"status": "aborted", "notes": "too early"})
    assert abort.status_code == 409, abort.text
    assert "started" in abort.json()["detail"].lower()

    # untouched - still planned
    assert client.get(f"/api/cell-uses/{use_id}").json()["status"] == "planned"


def test_stage_surfaces_qc_status_for_failed_use_and_stopped_cell(client):
    """The Weekly schedule grid flags a QC problem directly on the slot without a
    click-through - this only works if StageOut carries the use's own status and its
    cell's overall status through to the grid (see frontend SchedulerSlotView's qcAlert)."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nQ1,bcq1\nQ2,bcq2"})
    past = _past_weekday()
    future = _weekdays(1)[-1]

    r1 = _place(client, _sid(client, "Q1"), past, 0, {"mode": "new"})
    assert r1.status_code == 201, r1.text
    cycle1_id = r1.json()["cycle_id"]
    cell_use_id = r1.json()["stages"][0]["cell_use_id"]
    cell_id = r1.json()["stages"][0]["cell_id"]

    # Mark this use Failed - only this stage's cell_use_status flips, the cell stays open
    fail = client.patch(f"/api/cell-uses/{cell_use_id}", json={"status": "failed"})
    assert fail.status_code == 200, fail.text

    stage = client.get(f"/api/cycles/{cycle1_id}").json()["stages"][0]
    assert stage["cell_use_status"] == "failed"
    assert stage["cell_status"] == "open"

    # Reuse the (still open) cell for a second, still-planned use, then Stop the cell
    r2 = _place(client, _sid(client, "Q2"), future, 0, {"mode": "existing", "cell_id": cell_id})
    assert r2.status_code == 201, r2.text

    stop = client.post(f"/api/cells/{cell_id}/stop", json={"reason": "damaged"})
    assert stop.status_code == 200, stop.text

    # The first stage's own recorded outcome ("failed") is untouched history - stop_cell()
    # only cuts off the cell's *future*, not its past (see cell_service.stop_cell) - but the
    # cell's own status now correctly reads "stopped" too, since the physical cell itself is
    # out of service. The frontend grid relies on exactly this distinction to keep showing
    # "Failed" here rather than repainting it "Stopped" (see SchedulerSlotView's qcAlert).
    stage_after_stop = client.get(f"/api/cycles/{cycle1_id}").json()["stages"][0]
    assert stage_after_stop["cell_use_status"] == "failed"
    assert stage_after_stop["cell_status"] == "stopped"


def test_mark_cell_use_aborted_returns_sample_straight_to_backlog(client):
    """Aborted is a run/instrument problem, not a cell or sample one - unlike Failed, the
    sample goes straight back to the backlog with no separate Requeue step, and it's
    deliberately excluded from the PacBio credit workflow (has_failed_use only counts
    "failed", never "aborted")."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bca1"})
    past = _past_weekday()

    r1 = _place(client, _sid(client, "A1"), past, 0, {"mode": "new"})
    assert r1.status_code == 201, r1.text
    stage = r1.json()["stages"][0]
    cycle_id = r1.json()["cycle_id"]

    resp = client.patch(
        f"/api/cell-uses/{stage['cell_use_id']}", json={"status": "aborted", "notes": "instrument fault mid-run"}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "aborted"

    a1_id = _sid(client, "A1")
    assert _sample(client, a1_id)["status"] == "backlog"

    cell = client.get(f"/api/cells/{stage['cell_id']}").json()
    assert cell["status"] == "open"  # cell itself is untouched, still open for its other uses
    assert cell["uses_consumed"] == 1  # still counts as a consumed physical use, unlike "cancelled"
    assert cell["has_failed_use"] is False  # aborted is not a cell-quality failure
    assert cell["needs_qc_report"] is False  # so it never drives the PacBio credit workflow

    stage_after = client.get(f"/api/cycles/{cycle_id}").json()["stages"][0]
    assert stage_after["cell_use_status"] == "aborted"

    # The backlog-returned sample can be rescheduled immediately - no extra step needed.
    # Slot 4 (well A02, tray box 2), not slot 0 (well A01) - well A01 already has the
    # original cell's own physical tray loaded on it (see open_new_tray()'s box guard),
    # and reusing that same cell directly would trip the barcode-conflict guard instead
    # (it already burned bca1 on its own aborted use).
    reschedule = _place(client, a1_id, _weekdays(2)[-1], 4, {"mode": "new"})
    assert reschedule.status_code == 201, reschedule.text


def test_undo_mark_failed_restores_use_and_sample(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nU1,bcu1"})
    past = _past_weekday()

    r1 = _place(client, _sid(client, "U1"), past, 0, {"mode": "new"}, instrument="84093")
    assert r1.status_code == 201, r1.text
    stage = r1.json()["stages"][0]
    u1_id = _sid(client, "U1")
    assert _sample(client, u1_id)["status"] == "scheduled"

    fail = client.patch(f"/api/cell-uses/{stage['cell_use_id']}", json={"status": "failed", "notes": "no data"})
    assert fail.status_code == 200, fail.text
    assert _sample(client, u1_id)["status"] == "failed"

    undo = client.post(f"/api/cell-uses/{stage['cell_use_id']}/undo")
    assert undo.status_code == 200, undo.text
    assert undo.json()["status"] == "planned"
    assert undo.json()["started_at"] is None
    assert undo.json()["outcome_notes"] is None
    assert _sample(client, u1_id)["status"] == "scheduled"

    # the cell is untouched by either the mark or the undo - it stays open throughout
    cell = client.get(f"/api/cells/{stage['cell_id']}").json()
    assert cell["status"] == "open"
    assert cell["has_failed_use"] is False


def test_undo_mark_aborted_restores_use_and_sample(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nU2,bcu2"})
    past = _past_weekday()

    r1 = _place(client, _sid(client, "U2"), past, 0, {"mode": "new"}, instrument="84093")
    assert r1.status_code == 201, r1.text
    stage = r1.json()["stages"][0]
    u2_id = _sid(client, "U2")

    abort = client.patch(f"/api/cell-uses/{stage['cell_use_id']}", json={"status": "aborted"})
    assert abort.status_code == 200, abort.text
    assert _sample(client, u2_id)["status"] == "backlog"

    undo = client.post(f"/api/cell-uses/{stage['cell_use_id']}/undo")
    assert undo.status_code == 200, undo.text
    assert undo.json()["status"] == "planned"
    assert _sample(client, u2_id)["status"] == "scheduled"


def test_undo_rejected_for_a_use_that_was_never_flagged(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nU3,bcu3"})
    (mon,) = _weekdays(1)

    r1 = _place(client, _sid(client, "U3"), mon, 0, {"mode": "new"})
    assert r1.status_code == 201, r1.text
    use_id = r1.json()["stages"][0]["cell_use_id"]

    undo = client.post(f"/api/cell-uses/{use_id}/undo")
    assert undo.status_code == 409, undo.text
    assert "failed or aborted" in undo.json()["detail"].lower()


def test_undo_mark_failed_blocked_once_sample_has_moved_on(client):
    """If the sample was requeued and rescheduled onto a fresh placement before anyone
    clicked Undo on the original mistaken Mark Failed, reviving the old use back to
    "planned" would double-book that sample against its new placement - so undo must
    hard-block rather than silently reviving only the use and leaving the sample alone."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nU4,bcu4"})
    past = _past_weekday()
    future = _weekdays(3)[-1]

    r1 = _place(client, _sid(client, "U4"), past, 0, {"mode": "new"}, instrument="84093")
    assert r1.status_code == 201, r1.text
    old_use_id = r1.json()["stages"][0]["cell_use_id"]
    u4_id = _sid(client, "U4")

    assert client.patch(f"/api/cell-uses/{old_use_id}", json={"status": "failed"}).status_code == 200
    assert client.post(f"/api/samples/{u4_id}/requeue").status_code == 200

    r2 = _place(client, u4_id, future, 0, {"mode": "new"}, instrument="84309")
    assert r2.status_code == 201, r2.text
    assert _sample(client, u4_id)["status"] == "scheduled"

    undo = client.post(f"/api/cell-uses/{old_use_id}/undo")
    assert undo.status_code == 409, undo.text
    assert "moved on" in undo.json()["detail"].lower()

    # untouched - the old use stays failed, the new placement stays intact
    assert client.get(f"/api/cell-uses/{old_use_id}").json()["status"] == "failed"
    assert _sample(client, u4_id)["status"] == "scheduled"


def test_undo_stop_cell_reopens_cell_and_restores_planned_use(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nU5,bcu5\nU6,bcu6"})
    mon, _tue, wed = _weekdays(3)

    r1 = _place(client, _sid(client, "U5"), mon, 0, {"mode": "new"})
    assert r1.status_code == 201, r1.text
    cell_id = r1.json()["stages"][0]["cell_id"]
    cycle1_id = r1.json()["cycle_id"]

    assert client.patch(f"/api/cycles/{cycle1_id}", json={"status": "running"}).status_code == 200
    assert client.patch(f"/api/cycles/{cycle1_id}", json={"status": "completed"}).status_code == 200

    r2 = _place(client, _sid(client, "U6"), wed, 0, {"mode": "existing", "cell_id": cell_id})
    assert r2.status_code == 201, r2.text
    u6_use_id = r2.json()["stages"][0]["cell_use_id"]
    u6_id = _sid(client, "U6")

    stop = client.post(f"/api/cells/{cell_id}/stop", json={"reason": "wrong cell selected"})
    assert stop.status_code == 200, stop.text
    assert _sample(client, u6_id)["status"] == "backlog"

    undo = client.post(f"/api/cells/{cell_id}/undo-stop")
    assert undo.status_code == 200, undo.text
    assert undo.json()["cell"]["status"] == "open"
    assert undo.json()["cell"]["stopped_reason"] is None
    assert undo.json()["reverted_cell_use_ids"] == [u6_use_id]
    assert undo.json()["drifted_cell_use_ids"] == []

    assert client.get(f"/api/cell-uses/{u6_use_id}").json()["status"] == "planned"
    assert _sample(client, u6_id)["status"] == "scheduled"

    # Monday's completed use is untouched history throughout
    mon_cycle = client.get(f"/api/cycles/{cycle1_id}").json()
    assert mon_cycle["status"] == "completed"


def test_undo_stop_cell_rejects_when_not_stopped(client):
    boot = client.post("/api/cells/bootstrap", json={"max_uses": 3, "uses_consumed": 0, "burned_barcodes": []})
    cell_id = boot.json()["id"]

    undo = client.post(f"/api/cells/{cell_id}/undo-stop")
    assert undo.status_code == 409, undo.text
    assert "not stopped" in undo.json()["detail"].lower()


def test_undo_stop_cell_leaves_drifted_use_cancelled_but_restores_the_rest(client):
    """Stop cell can cancel several planned uses at once. If one of those samples gets
    requeued and rescheduled elsewhere before Undo is clicked, only that one use must stay
    cancelled (reviving it would double-book its sample) - the other, untouched use still
    comes back."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nU7,bcu7\nU8,bcu8\nU9,bcu9"})
    mon, tue, wed = _weekdays(3)

    r1 = _place(client, _sid(client, "U7"), mon, 0, {"mode": "new"})
    assert r1.status_code == 201, r1.text
    cell_id = r1.json()["stages"][0]["cell_id"]
    cycle1_id = r1.json()["cycle_id"]

    # confirm+complete U7's run so its own use is real history, not itself a "planned" use
    # that Stop cell would also cancel - isolates the drift scenario to U8 vs U9 below.
    assert client.patch(f"/api/cycles/{cycle1_id}", json={"status": "running"}).status_code == 200
    assert client.patch(f"/api/cycles/{cycle1_id}", json={"status": "completed"}).status_code == 200

    r2 = _place(client, _sid(client, "U8"), tue, 0, {"mode": "existing", "cell_id": cell_id})
    assert r2.status_code == 201, r2.text
    u8_use_id = r2.json()["stages"][0]["cell_use_id"]
    u8_id = _sid(client, "U8")

    r3 = _place(client, _sid(client, "U9"), wed, 0, {"mode": "existing", "cell_id": cell_id})
    assert r3.status_code == 201, r3.text
    u9_use_id = r3.json()["stages"][0]["cell_use_id"]
    u9_id = _sid(client, "U9")

    stop = client.post(f"/api/cells/{cell_id}/stop", json={"reason": "damaged"})
    assert stop.status_code == 200, stop.text

    # U8's sample moves on before anyone undoes the stop (already "backlog" from the stop
    # cascade, so it can be rescheduled directly - no separate requeue step); U9's sample
    # sits untouched.
    reschedule = _place(client, u8_id, _weekdays(5)[-1], 0, {"mode": "new"}, instrument="84098")
    assert reschedule.status_code == 201, reschedule.text

    undo = client.post(f"/api/cells/{cell_id}/undo-stop")
    assert undo.status_code == 200, undo.text
    body = undo.json()
    assert body["cell"]["status"] == "open"
    assert body["reverted_cell_use_ids"] == [u9_use_id]
    assert body["drifted_cell_use_ids"] == [u8_use_id]

    # U9 is fully restored; U8's old use stays cancelled and its sample keeps its new placement
    assert client.get(f"/api/cell-uses/{u9_use_id}").json()["status"] == "planned"
    assert _sample(client, u9_id)["status"] == "scheduled"
    assert client.get(f"/api/cell-uses/{u8_use_id}").json()["status"] == "cancelled"
    assert _sample(client, u8_id)["status"] == "scheduled"


def test_bulk_clear_style_removal_skips_cancelled_marker_and_removes_the_rest(client):
    """Simulates the frontend's "Clear schedule" bulk action (loop DELETE over every
    stage) against a week that has a stopped cell's cancelled marker in it - the scenario
    reported as "the schedule looks cleared but I can no longer schedule anything". The
    frontend's weekPlannedStages filter now excludes the cancelled stage from that payload
    up front, but this confirms the backend's own per-item behaviour degrades gracefully
    even if something else still sends it: the 3 real placements are removed, the
    cancelled marker survives untouched, and the resulting cycle - down to just that one
    marker - is exactly what isCellOpen/auto_fill's occupied-check need to see to treat the
    day as open again."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nD1,bcd1\nD2,bcd2\nD3,bcd3\nD4,bcd4"})
    (mon,) = _weekdays(1)

    r1 = _place(client, _sid(client, "D1"), mon, 0, {"mode": "new"})
    cell_id = r1.json()["stages"][0]["cell_id"]
    cycle_id = r1.json()["cycle_id"]
    tray_id = r1.json()["stages"][0]["tray_id"]
    # D1's placement already opened the whole physical tray (eager tray-of-4 population) -
    # its 3 unused siblings occupy wells B01/C01/D01, so D2-D4 must reuse them via
    # "existing" (see open_new_tray()'s box guard) rather than each opening a competing
    # new tray at a well the first tray already occupies.
    tray_cells = {
        c["current_well"]: c["id"]
        for c in client.get("/api/cells", params={"tray_id": tray_id, "page_size": 10}).json()["items"]
    }
    r2 = _place(client, _sid(client, "D2"), mon, 1, {"mode": "existing", "cell_id": tray_cells["B01"]})
    r3 = _place(client, _sid(client, "D3"), mon, 2, {"mode": "existing", "cell_id": tray_cells["C01"]})
    r4 = _place(client, _sid(client, "D4"), mon, 3, {"mode": "existing", "cell_id": tray_cells["D01"]})
    # All 4 placements land in the same instrument/date cycle, so every response above
    # echoes that whole cycle's stages, not just its own - and stages are well-sorted, so
    # stages[0] is always D1's own use (well A01) in every one of r1..r4's payload. Read the
    # final response (r4, which by now includes all 4 stages) and key off slot_index (which
    # each _place call above pinned explicitly to 0/1/2/3) instead.
    final_stages = {s["slot_index"]: s["cell_use_id"] for s in r4.json()["stages"]}
    all_use_ids = [final_stages[i] for i in range(4)]

    stop = client.post(f"/api/cells/{cell_id}/stop", json={"reason": "damaged"})
    assert stop.status_code == 200, stop.text

    # simulate the OLD, unfiltered bulk-clear payload - every stage in the (still
    # "planned") cycle, including the now-cancelled one
    statuses = [client.delete(f"/api/cell-uses/{use_id}").status_code for use_id in all_use_ids]
    assert statuses.count(204) == 3
    assert statuses.count(409) == 1

    cycle = client.get(f"/api/cycles/{cycle_id}").json()
    assert len(cycle["stages"]) == 1
    assert cycle["stages"][0]["cell_use_status"] == "cancelled"

    backlog_ids = {
        s["id"] for s in client.get("/api/samples", params={"status": "backlog", "page_size": 50}).json()["items"]
    }
    assert {_sid(client, "D2"), _sid(client, "D3"), _sid(client, "D4")} <= backlog_ids
