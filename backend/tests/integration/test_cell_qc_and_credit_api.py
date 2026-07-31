"""Cell QC: the unified Fail / Fail-and-Stop / Retire flow (POST /api/cells/{id}/qc/*),
its continuous-queue tray re-zip (a failed/retired cell shifts every downstream sample onto
the next surviving cell-use and displaces the tail), the per-sample disposition step
(Lost -> top-up, Repeatable/Recoverable -> backlog above High), undo, the top-up list, and
the PacBio credit workflow that a Fail/Fail-and-Stop still feeds."""
from datetime import date, timedelta

from tests.integration._qc_helpers import qc_commit, qc_preview, qc_retire, qc_stop


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


def _stages(run):
    return [s for p in run["plates"] for s in p["stages"]]


def _sid(client, external_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["external_id"] == external_id)


def _sample(client, sample_id: int) -> dict:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s for s in items if s["id"] == sample_id)


def _place(client, sample_id, run_date, slot_index, cell_choice, run_time_hours=24, instrument="84047"):
    return client.post(
        "/api/cell-uses",
        json={
            "sample_id": sample_id,
            "instrument_serial": instrument,
            "load_date": run_date,
            "slot_index": slot_index,
            "cell_choice": cell_choice,
            "run_time_hours": run_time_hours,
            "max_uses": 3,
        },
    )


def _tray_cells_by_well(client, tray_id) -> dict[str, int]:
    return {
        c["current_well"]: c["id"]
        for c in client.get("/api/cells", params={"tray_id": tray_id, "page_size": 10}).json()["items"]
    }


def _build_worked_example(client):
    """4-cell tray, Use 1 (Mon) then Use 2 (Wed reuse), one sample per cell per use - the
    exact scenario from the plan. Returns (cellA_id, cells_by_well, mon_use1_A_id, wed_run_id,
    mon_run_id). Mon's run is confirmed running so its uses are real; Wed's Use 2 stays planned."""
    client.post(
        "/api/imports",
        json={"raw_text": "sample,barcodes\n" + "\n".join(f"P{p}{w},bc{p}{w}" for p in (1, 2) for w in "ABCD")},
    )
    mon, _tue, wed = _weekdays(3)

    r = _place(client, _sid(client, "P1A"), mon, 0, {"mode": "new"})
    assert r.status_code == 201, r.text
    mon_run_id = r.json()["run_id"]
    cellA = _stages(r.json())[0]["cell_id"]
    tray_id = _stages(r.json())[0]["tray_id"]
    cells = _tray_cells_by_well(client, tray_id)  # {A01: cellA, B01: cellB, ...}
    for slot, well in ((1, "B01"), (2, "C01"), (3, "D01")):
        rr = _place(client, _sid(client, f"P1{well[0]}"), mon, slot, {"mode": "existing", "cell_id": cells[well]})
        assert rr.status_code == 201, rr.text
    # confirm Monday's Use-1 run loaded (so a QC verdict can anchor on it)
    assert client.patch(f"/api/cycles/{mon_run_id}", json={"status": "running"}).status_code == 200

    wed_run_id = None
    for slot, well in ((0, "A01"), (1, "B01"), (2, "C01"), (3, "D01")):
        rr = _place(client, _sid(client, f"P2{well[0]}"), wed, slot, {"mode": "existing", "cell_id": cells[well]})
        assert rr.status_code == 201, rr.text
        wed_run_id = rr.json()["run_id"]

    mon_use1_A = next(s["cell_use_id"] for s in _stages(client.get(f"/api/cycles/{mon_run_id}").json()) if s["cell_id"] == cellA)
    return cellA, cells, mon_use1_A, wed_run_id, mon_run_id


# --------------------------------------------------------------------------------------
# Fail Cell (no shift)
# --------------------------------------------------------------------------------------


def test_fail_cell_loses_only_its_sample_and_keeps_the_cell_open(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nF1,bcf1"})
    past = _past_weekday()
    r1 = _place(client, _sid(client, "F1"), past, 0, {"mode": "new"})
    assert r1.status_code == 201, r1.text
    stage = _stages(r1.json())[0]
    assert client.patch(f"/api/cycles/{r1.json()['run_id']}", json={"status": "running"}).status_code == 200

    preview = qc_preview(client, stage["cell_id"], "fail", stage["cell_use_id"])
    assert preview.status_code == 200, preview.text
    affected = preview.json()["affected_samples"]
    assert len(affected) == 1
    assert affected[0]["role"] == "failed" and affected[0]["disposition_required"] is True
    assert preview.json()["requires_disposition"] is True

    f1_id = _sid(client, "F1")
    commit = qc_commit(client, stage["cell_id"], "fail", stage["cell_use_id"], {f1_id: "lost"}, reason="no data")
    assert commit.status_code == 200, commit.text

    cell = client.get(f"/api/cells/{stage['cell_id']}").json()
    assert cell["status"] == "open"  # Fail Cell does NOT stop the cell
    assert cell["uses_consumed"] == 1
    assert cell["has_failed_use"] is True
    assert cell["needs_qc_report"] is True
    assert _sample(client, f1_id)["status"] == "failed"
    # Lost -> a top-up entry now exists for F1
    topups = client.get("/api/topups").json()
    assert [t["sample_id"] for t in topups] == [f1_id]


def test_patch_cell_use_failed_is_rejected_and_points_at_qc(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nZ1,bcz1"})
    past = _past_weekday()
    r1 = _place(client, _sid(client, "Z1"), past, 0, {"mode": "new"})
    stage = _stages(r1.json())[0]
    assert client.patch(f"/api/cycles/{r1.json()['run_id']}", json={"status": "running"}).status_code == 200

    resp = client.patch(f"/api/cell-uses/{stage['cell_use_id']}", json={"status": "failed"})
    assert resp.status_code == 409, resp.text
    assert "qc" in resp.json()["detail"].lower()


# --------------------------------------------------------------------------------------
# Fail-and-Stop: the worked-example tray re-zip
# --------------------------------------------------------------------------------------


def test_fail_and_stop_rezips_the_tray_and_displaces_the_tail(client):
    cellA, cells, mon_use1_A, wed_run_id, _mon_run_id = _build_worked_example(client)

    preview = qc_preview(client, cellA, "fail_and_stop", mon_use1_A)
    assert preview.status_code == 200, preview.text
    by_sample = {a["external_id"]: a for a in preview.json()["affected_samples"]}
    # P1A failed; P2A/P2B/P2C shifted onto the next cell (B/C/D); P2D displaced off the tail.
    assert by_sample["P1A"]["role"] == "failed"
    assert by_sample["P2A"]["role"] == "reassigned" and by_sample["P2A"]["actual_cell_code"] == by_sample["P2B"]["planned_cell_code"]
    assert {"P2A", "P2B", "P2C"} <= {k for k, v in by_sample.items() if v["reassigned"]}
    assert by_sample["P2D"]["role"] == "displaced"
    assert {k for k, v in by_sample.items() if v["disposition_required"]} == {"P1A", "P2D"}

    commit = qc_commit(
        client,
        cellA,
        "fail_and_stop",
        mon_use1_A,
        {_sid(client, "P1A"): "lost", _sid(client, "P2D"): "recoverable"},
        reason="cell died",
    )
    assert commit.status_code == 200, commit.text
    body = commit.json()
    assert body["cell"]["status"] == "stopped"

    wed = client.get(f"/api/cycles/{wed_run_id}").json()
    wed_stages = {s["sample_external_id"]: s for s in _stages(wed)}
    # P2A now backs cell B (its planned neighbour), flagged reassigned; P2D is a cancelled tail.
    assert wed_stages["P2A"]["cell_id"] == cells["B01"]
    assert wed_stages["P2A"]["reassigned"] is True
    assert wed_stages["P2A"]["cell_use_status"] == "planned"
    assert wed_stages["P2D"]["cell_use_status"] == "cancelled"

    assert _sample(client, _sid(client, "P1A"))["status"] == "failed"  # lost -> top-up
    p2d = _sample(client, _sid(client, "P2D"))
    assert p2d["status"] == "backlog" and p2d["qc_disposition"] == "recoverable"
    assert p2d["priority"] == "Recoverable (0)"
    assert [t["sample_id"] for t in client.get("/api/topups").json()] == [_sid(client, "P1A")]


def test_fail_and_stop_requires_dispositions_for_every_must_dispose_sample(client):
    cellA, _cells, mon_use1_A, _wed, _mon = _build_worked_example(client)
    # Omit P2D's disposition -> 409, nothing committed.
    commit = qc_commit(client, cellA, "fail_and_stop", mon_use1_A, {_sid(client, "P1A"): "lost"})
    assert commit.status_code == 409, commit.text
    assert client.get(f"/api/cells/{cellA}").json()["status"] == "open"  # untouched


# --------------------------------------------------------------------------------------
# Retire: shifts future uses without failing the current one
# --------------------------------------------------------------------------------------


def test_retire_rezips_future_uses_without_failing_the_current_use(client):
    cellA, cells, mon_use1_A, wed_run_id, mon_run_id = _build_worked_example(client)

    preview = qc_preview(client, cellA, "retire", None)
    assert preview.status_code == 200, preview.text
    by_sample = {a["external_id"]: a for a in preview.json()["affected_samples"]}
    # No failed sample (retire doesn't fail the current use); P2A/B/C shift, P2D displaced.
    assert "P1A" not in by_sample
    assert {k for k, v in by_sample.items() if v["disposition_required"]} == {"P2D"}

    commit = qc_commit(client, cellA, "retire", None, {_sid(client, "P2D"): "repeatable"})
    assert commit.status_code == 200, commit.text
    assert commit.json()["cell"]["status"] == "retired"

    # Monday's Use 1 (P1A) is untouched - still running, not failed.
    mon_stage = next(s for s in _stages(client.get(f"/api/cycles/{mon_run_id}").json()) if s["cell_id"] == cellA)
    assert mon_stage["cell_use_status"] == "started"
    p2d = _sample(client, _sid(client, "P2D"))
    assert p2d["status"] == "backlog" and p2d["qc_disposition"] == "repeatable"


# --------------------------------------------------------------------------------------
# Barcode clash flagged on a shift
# --------------------------------------------------------------------------------------


def test_shift_onto_a_cell_with_a_clashing_burned_barcode_is_flagged(client):
    """P2A's barcode collides with P1B's. Planned on cell A (no clash there), the re-zip
    shifts P2A onto cell B - which already burned that barcode on Use 1 - so it's flagged."""
    rows = [("P1A", "bcaa"), ("P1B", "bcSHARED"), ("P1C", "bccc"), ("P1D", "bcdd"),
            ("P2A", "bcSHARED"), ("P2B", "bcbb2"), ("P2C", "bccc2"), ("P2D", "bcdd2")]
    client.post("/api/imports", json={"raw_text": "sample,barcodes\n" + "\n".join(f"{s},{b}" for s, b in rows)})
    mon, _tue, wed = _weekdays(3)

    r = _place(client, _sid(client, "P1A"), mon, 0, {"mode": "new"})
    cellA = _stages(r.json())[0]["cell_id"]
    mon_run_id = r.json()["run_id"]
    cells = _tray_cells_by_well(client, _stages(r.json())[0]["tray_id"])
    for slot, well in ((1, "B01"), (2, "C01"), (3, "D01")):
        _place(client, _sid(client, f"P1{well[0]}"), mon, slot, {"mode": "existing", "cell_id": cells[well]})
    assert client.patch(f"/api/cycles/{mon_run_id}", json={"status": "running"}).status_code == 200
    for slot, well in ((0, "A01"), (1, "B01"), (2, "C01"), (3, "D01")):
        _place(client, _sid(client, f"P2{well[0]}"), wed, slot, {"mode": "existing", "cell_id": cells[well]})
    mon_use1_A = next(s["cell_use_id"] for s in _stages(client.get(f"/api/cycles/{mon_run_id}").json()) if s["cell_id"] == cellA)

    preview = qc_preview(client, cellA, "fail_and_stop", mon_use1_A)
    p2a = next(a for a in preview.json()["affected_samples"] if a["external_id"] == "P2A")
    assert p2a["reassigned"] is True
    assert p2a["barcode_clash"] is True

    commit = qc_commit(
        client, cellA, "fail_and_stop", mon_use1_A,
        {_sid(client, "P1A"): "lost", _sid(client, "P2D"): "recoverable"},
    )
    assert commit.status_code == 200, commit.text
    assert len(commit.json()["clash_cell_use_ids"]) == 1


# --------------------------------------------------------------------------------------
# Preview is read-only; Undo restores
# --------------------------------------------------------------------------------------


def test_preview_does_not_mutate(client):
    cellA, _cells, mon_use1_A, _wed, _mon = _build_worked_example(client)
    before = client.get(f"/api/cells/{cellA}").json()["status"]
    qc_preview(client, cellA, "fail_and_stop", mon_use1_A)
    qc_preview(client, cellA, "retire", None)
    assert client.get(f"/api/cells/{cellA}").json()["status"] == before == "open"
    assert client.get("/api/topups").json() == []


def test_undo_qc_reopens_the_cell_and_restores_uses_and_samples(client):
    cellA, cells, mon_use1_A, wed_run_id, _mon = _build_worked_example(client)
    qc_commit(
        client, cellA, "fail_and_stop", mon_use1_A,
        {_sid(client, "P1A"): "lost", _sid(client, "P2D"): "recoverable"},
    )
    assert client.get(f"/api/cells/{cellA}").json()["status"] == "stopped"

    undo = client.post(f"/api/cells/{cellA}/qc/undo")
    assert undo.status_code == 200, undo.text
    assert undo.json()["cell"]["status"] == "open"

    # P2A moves back onto cell A; P2D's cancelled tail is planned again; the top-up is gone.
    wed_stages = {s["sample_external_id"]: s for s in _stages(client.get(f"/api/cycles/{wed_run_id}").json())}
    assert wed_stages["P2A"]["cell_id"] == cellA
    assert wed_stages["P2A"]["reassigned"] is False
    assert wed_stages["P2D"]["cell_use_status"] == "planned"
    assert _sample(client, _sid(client, "P2D"))["status"] == "scheduled"
    assert _sample(client, _sid(client, "P2D"))["qc_disposition"] is None
    assert client.get("/api/topups").json() == []


# --------------------------------------------------------------------------------------
# Top-up list actions
# --------------------------------------------------------------------------------------


def test_topup_request_sent_then_cancel(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nT1,bct1"})
    past = _past_weekday()
    r1 = _place(client, _sid(client, "T1"), past, 0, {"mode": "new"})
    stage = _stages(r1.json())[0]
    assert client.patch(f"/api/cycles/{r1.json()['run_id']}", json={"status": "running"}).status_code == 200
    qc_commit(client, stage["cell_id"], "fail", stage["cell_use_id"], {_sid(client, "T1"): "lost"})

    topups = client.get("/api/topups").json()
    assert len(topups) == 1 and topups[0]["request_sent_at"] is None
    tid = topups[0]["id"]

    sent = client.post(f"/api/topups/{tid}/request-sent")
    assert sent.status_code == 200, sent.text
    assert sent.json()["request_sent_at"] is not None
    assert client.get("/api/topups", params={"status": "pending"}).json() == []
    assert len(client.get("/api/topups", params={"status": "sent"}).json()) == 1

    assert client.delete(f"/api/topups/{tid}").status_code == 204
    assert client.get("/api/topups").json() == []


# --------------------------------------------------------------------------------------
# PacBio credit workflow (still fed by a Fail / Fail-and-Stop)
# --------------------------------------------------------------------------------------


def test_credit_workflow_after_fail_and_stop(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nC1,bcc1"})
    past = _past_weekday()
    r1 = _place(client, _sid(client, "C1"), past, 0, {"mode": "new"})
    stage = _stages(r1.json())[0]
    cell_id = stage["cell_id"]
    assert client.patch(f"/api/cycles/{r1.json()['run_id']}", json={"status": "running"}).status_code == 200
    qc_commit(client, cell_id, "fail_and_stop", stage["cell_use_id"], {_sid(client, "C1"): "lost"})

    unreported = client.get("/api/cells", params={"qc_status": "unreported"}).json()
    assert cell_id in [c["id"] for c in unreported["items"]]

    assert client.post(f"/api/cells/{cell_id}/report-to-pacbio", json={"case_number": "CASE-9"}).status_code == 200
    awaiting = client.get("/api/cells", params={"qc_status": "awaiting_credit"}).json()
    assert cell_id in [c["id"] for c in awaiting["items"]]
    assert client.post(f"/api/cells/{cell_id}/confirm-credit", json={}).status_code == 200
    assert client.post(f"/api/cells/{cell_id}/receive-credit", json={}).status_code == 200
    awaiting_after = client.get("/api/cells", params={"qc_status": "awaiting_credit"}).json()
    assert cell_id not in [c["id"] for c in awaiting_after["items"]]


def test_qc_status_in_workflow_lists_every_stage_and_excludes_healthy_cells(client):
    """The QC page's feed (qc_status=in_workflow) returns every failed/stopped cell at ANY credit
    stage - unlike unreported/awaiting_credit, which each only match one stage - and never a
    healthy, never-failed cell."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nW1,bcw1"})
    past = _past_weekday()
    r1 = _place(client, _sid(client, "W1"), past, 0, {"mode": "new"})
    stage = _stages(r1.json())[0]
    cell_id = stage["cell_id"]
    # A never-used sibling in the same fresh tray is a healthy cell that must stay out of the feed.
    sibling_id = next(cid for cid in _tray_cells_by_well(client, stage["tray_id"]).values() if cid != cell_id)
    assert client.patch(f"/api/cycles/{r1.json()['run_id']}", json={"status": "running"}).status_code == 200
    qc_commit(client, cell_id, "fail_and_stop", stage["cell_use_id"], {_sid(client, "W1"): "lost"})

    def in_workflow_ids():
        return [c["id"] for c in client.get("/api/cells", params={"qc_status": "in_workflow", "page_size": 200}).json()["items"]]

    # Needs-report stage: the stopped cell is in the feed; its healthy sibling is not.
    assert cell_id in in_workflow_ids()
    assert sibling_id not in in_workflow_ids()

    # It stays in the feed through report -> confirm -> receive (a settled tail the page still shows).
    assert client.post(f"/api/cells/{cell_id}/report-to-pacbio", json={"case_number": "CASE-IW"}).status_code == 200
    assert cell_id in in_workflow_ids()
    assert client.post(f"/api/cells/{cell_id}/confirm-credit", json={}).status_code == 200
    assert cell_id in in_workflow_ids()
    assert client.post(f"/api/cells/{cell_id}/receive-credit", json={}).status_code == 200
    assert cell_id in in_workflow_ids()


def test_internal_report_link_saved_and_timestamped(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nIR1,bcir1"})
    past = _past_weekday()
    r1 = _place(client, _sid(client, "IR1"), past, 0, {"mode": "new"})
    stage = _stages(r1.json())[0]
    cell_id = stage["cell_id"]
    assert client.patch(f"/api/cycles/{r1.json()['run_id']}", json={"status": "running"}).status_code == 200
    qc_commit(client, cell_id, "fail_and_stop", stage["cell_use_id"], {_sid(client, "IR1"): "lost"})

    link = "https://docs.google.com/spreadsheets/d/abc#gid=0"
    r = client.post(f"/api/cells/{cell_id}/internal-report", json={"link": link})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["internal_report_link"] == link
    first_stamp = body["internal_report_at"]
    assert first_stamp is not None

    # Editing the link keeps the original raised-at timestamp.
    r2 = client.post(f"/api/cells/{cell_id}/internal-report", json={"link": link + "&edited"})
    assert r2.status_code == 200, r2.text
    assert r2.json()["internal_report_link"] == link + "&edited"
    assert r2.json()["internal_report_at"] == first_stamp


def test_internal_report_rejected_without_failure(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nIR2,bcir2"})
    past = _past_weekday()
    r1 = _place(client, _sid(client, "IR2"), past, 0, {"mode": "new"})
    cell_id = _stages(r1.json())[0]["cell_id"]
    r = client.post(f"/api/cells/{cell_id}/internal-report", json={"link": "https://example.com"})
    assert r.status_code == 409, r.text


# --------------------------------------------------------------------------------------
# Guards; aborted (a run problem, not QC) still flows through the run lifecycle
# --------------------------------------------------------------------------------------


def test_qc_rejects_a_use_before_its_run_has_started(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nP3,bcp3"})
    future = _weekdays(3)[-1]
    r1 = _place(client, _sid(client, "P3"), future, 0, {"mode": "new"}, instrument="84093")
    stage = _stages(r1.json())[0]
    preview = qc_preview(client, stage["cell_id"], "fail_and_stop", stage["cell_use_id"])
    assert preview.status_code == 409, preview.text
    assert "started" in preview.json()["detail"].lower()


def test_qc_rejects_second_verdict_on_a_terminal_cell(client):
    cellA, _cells, mon_use1_A, _wed, _mon = _build_worked_example(client)
    qc_commit(client, cellA, "fail_and_stop", mon_use1_A, {_sid(client, "P1A"): "lost", _sid(client, "P2D"): "recoverable"})
    again = qc_preview(client, cellA, "fail_and_stop", mon_use1_A)
    assert again.status_code == 409
    assert "already" in again.json()["detail"].lower()


def test_mark_cell_use_aborted_returns_sample_straight_to_backlog(client):
    """Aborted is a run/instrument problem, not cell QC - still handled by the run-lifecycle
    PATCH, sample straight back to the backlog, cell untouched and not credit-eligible."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bca1"})
    past = _past_weekday()
    r1 = _place(client, _sid(client, "A1"), past, 0, {"mode": "new"})
    stage = _stages(r1.json())[0]
    assert client.patch(f"/api/cycles/{r1.json()['run_id']}", json={"status": "running"}).status_code == 200

    resp = client.patch(f"/api/cell-uses/{stage['cell_use_id']}", json={"status": "aborted", "notes": "instrument fault"})
    assert resp.status_code == 200, resp.text
    a1 = _sample(client, _sid(client, "A1"))
    assert a1["status"] == "backlog"
    cell = client.get(f"/api/cells/{stage['cell_id']}").json()
    assert cell["status"] == "open" and cell["has_failed_use"] is False and cell["needs_qc_report"] is False


def test_aborted_still_rejected_before_run_started(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA2,bca2"})
    future = _weekdays(3)[-1]
    r1 = _place(client, _sid(client, "A2"), future, 0, {"mode": "new"}, instrument="84093")
    use_id = _stages(r1.json())[0]["cell_use_id"]
    abort = client.patch(f"/api/cell-uses/{use_id}", json={"status": "aborted"})
    assert abort.status_code == 409, abort.text
    assert "started" in abort.json()["detail"].lower()
