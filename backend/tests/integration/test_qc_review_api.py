"""QC Review (GET /api/qc/review, POST /api/qc/review/ignore|restore): SMRT cells the QC team
failed in LangQC (MLWH) that RunNx has no fail mark on.

MLWH is stood in for by an SQLite copy of its tables (the `fake_mlwh` fixture, tests/mlwh_fake.py),
and the real query runs against it - so the SQL, its joins and its filters are exercised."""
from datetime import date, datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from app.services import mlwh, mlwh_wells


def _past_weekday(days_back: int = 2) -> date:
    d = date.today() - timedelta(days=days_back)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def _sid(client, pool_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["pool_id"] == pool_id)


def _loaded_run(client, pool_id="TRAC-2-100", *, load=None, run_name="TRACTION-RUN-2589", lock=True, slot=0) -> int:
    """One sample on a past run on 84047 (slot 0 = Plate 1 A01), optionally confirmed loaded."""
    client.post("/api/imports", json={"raw_text": f"sample,barcodes\n{pool_id},bc{pool_id[-3:]}"})
    placed = client.post("/api/cell-uses", json={
        "sample_id": _sid(client, pool_id), "instrument_serial": "84047",
        "load_date": (load or _past_weekday()).isoformat(), "slot_index": slot,
        "cell_choice": {"mode": "new"}, "run_time_hours": 24,
    })
    assert placed.status_code == 201, placed.text
    run_id = placed.json()["run_id"]
    if lock:
        body = {"status": "running"} | ({"run_name": run_name} if run_name else {})
        assert client.patch(f"/api/cycles/{run_id}", json=body).status_code == 200
    return run_id


def _review(client) -> dict:
    resp = client.get("/api/qc/review")
    assert resp.status_code == 200, resp.text
    return resp.json()


def _confirm_fail(client, match: dict, *, source="qc_review"):
    preview = client.post(f"/api/cells/{match['cell_id']}/qc/preview",
                          json={"verdict": "fail", "cell_use_id": match["cell_use_id"]})
    assert preview.status_code == 200, preview.text
    dispositions = {a["sample_id"]: "repeatable" for a in preview.json()["affected_samples"] if a["disposition_required"]}
    body = {"verdict": "fail", "cell_use_id": match["cell_use_id"], "reason": "QC Review: Failed, SMRT cell",
            "dispositions": dispositions} | ({"source": source} if source else {})
    resp = client.post(f"/api/cells/{match['cell_id']}/qc/commit", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()["cell"]


# --- MLWH availability ---------------------------------------------------------------------


def test_not_configured_is_a_state_not_an_error(client, monkeypatch):
    monkeypatch.setattr(mlwh, "is_configured", lambda: False)
    body = _review(client)
    assert body["configured"] is False and body["ok"] is False
    assert body["pending"] == [] and body["lookback_days"] == 90


def test_mlwh_failure_comes_back_as_an_error_message(client, monkeypatch):
    empty = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)  # no tables: the query fails
    monkeypatch.setattr(mlwh, "is_configured", lambda: True)
    monkeypatch.setattr(mlwh_wells, "engine", lambda: empty)
    body = _review(client)
    assert body["configured"] is True and body["ok"] is False
    assert "pac_bio_run_well_metrics" in body["error"]


# --- Which wells come in ---------------------------------------------------------------------


def test_only_cell_and_instrument_failures_inside_the_lookback_come_in(client, fake_mlwh):
    fake_mlwh.add_well(well="A1", state="Failed, SMRT cell")
    fake_mlwh.add_well(well="B1", state="Failed, Instrument", qc_on=datetime.now() - timedelta(days=10))
    fake_mlwh.add_well(well="C1", state="Failed")  # the sample missed its metrics - not a credit case
    fake_mlwh.add_well(well="D1", state="Passed")
    fake_mlwh.add_well(plate=2, well="A1", state="On hold")
    fake_mlwh.add_well(run="TRACTION-RUN-1", state="Failed, SMRT cell", instrument_type="Sequel2e")
    old = datetime.now() - timedelta(days=120)
    fake_mlwh.add_well(run="TRACTION-RUN-2", state="Failed, SMRT cell", start=old, qc_on=old)

    body = _review(client)
    assert body["ok"] is True
    # Oldest sign-off first, like the rest of the QC worklist.
    assert [(w["well_label"], w["qc_state"]) for w in body["pending"]] == [
        ("B1", "Failed, Instrument"), ("A1", "Failed, SMRT cell")
    ]
    well = next(w for w in body["pending"] if w["well_label"] == "A1")
    assert well["key"] == "TRACTION-RUN-2589|1|A1"
    assert well["library_barcodes"] == ["TRAC-2-100"] and well["sample_count"] == 1
    assert well["hifi_yield_gb"] == 12.5 and well["is_multi_use"] is True
    assert well["smrt_link_url"] == "https://smrtlink.example.org:8243/sl/runs/11111111-2222"

    # The lookback is a setting: widen it and the 120-day-old failure comes in too.
    client.put("/api/settings/qc", json={"review_lookback_days": 150})
    assert len(_review(client)["pending"]) == 3


def test_a_pooled_well_lists_each_library_tube_once(client, fake_mlwh):
    fake_mlwh.add_well(libraries=("TRAC-2-200", "TRAC-2-200", "TRAC-2-201"))
    (well,) = _review(client)["pending"]
    assert well["library_barcodes"] == ["TRAC-2-200", "TRAC-2-201"]


# --- Matching to RunNx ---------------------------------------------------------------------


def test_matches_the_runnx_use_by_traction_run_plate_and_well(client, fake_mlwh):
    _loaded_run(client, run_name="traction-run 2589")  # typed loosely in RunNx - still the same run
    fake_mlwh.add_well()
    fake_mlwh.add_well(well="B1")  # nothing in RunNx's B01

    pending = {w["well_label"]: w for w in _review(client)["pending"]}
    match = pending["A1"]["match"]
    assert match["by"] == "run_name"
    assert match["cell_code"] and match["use_number"] == 1 and match["use_status"] == "started"
    assert match["pool_id"] == "TRAC-2-100" and match["pool_matches"] is True
    assert match["can_fail"] is True and match["blocked_reason"] is None

    empty_well = pending["B1"]["match"]
    assert empty_well["run_batch_id"] == match["run_batch_id"] and empty_well["cell_use_id"] is None
    assert empty_well["can_fail"] is False and "nothing in this plate and well" in empty_well["blocked_reason"]
    assert empty_well["log_instead"] is True and match["log_instead"] is False


def test_pool_mismatch_is_flagged(client, fake_mlwh):
    _loaded_run(client)
    fake_mlwh.add_well(libraries=("TRAC-2-999",))
    assert _review(client)["pending"][0]["match"]["pool_matches"] is False


def test_unnamed_runnx_run_matches_by_instrument_and_load_day(client, fake_mlwh):
    load = _past_weekday(4)
    _loaded_run(client, load=load, run_name=None)
    fake_mlwh.add_well(start=datetime.combine(load + timedelta(days=1), datetime.min.time()) + timedelta(hours=3))
    match = _review(client)["pending"][0]["match"]
    assert match["by"] == "instrument_date" and match["cell_use_id"] is not None


def test_a_differently_named_runnx_run_is_not_matched_by_instrument(client, fake_mlwh):
    _loaded_run(client, run_name="TRACTION-RUN-7777")
    fake_mlwh.add_well(run="TRACTION-RUN-2589")
    assert _review(client)["pending"][0]["match"] is None


def test_a_run_not_confirmed_loaded_cannot_be_failed_yet(client, fake_mlwh):
    _loaded_run(client, lock=False)
    fake_mlwh.add_well(run="TRACTION-RUN-2589", instrument="84047")
    match = _review(client)["pending"][0]["match"]
    assert match["by"] == "instrument_date" and match["can_fail"] is False
    assert "isn't confirmed loaded" in match["blocked_reason"]
    # Not failable *yet* - confirm the run loaded, then fail it; logging a case would duplicate the cell's.
    assert match["log_instead"] is False


# --- Leaving the queue ---------------------------------------------------------------------


def test_confirm_fail_labels_the_case_qc_review_and_takes_the_well_out(client, fake_mlwh):
    _loaded_run(client)
    fake_mlwh.add_well()
    match = _review(client)["pending"][0]["match"]

    cell = _confirm_fail(client, match)
    assert cell["credit_source"] == "qc_review" and cell["needs_qc_report"] is True
    body = _review(client)
    assert body["pending"] == [] and body["already_failed"] == 1
    worklist = client.get("/api/cells", params={"qc_status": "in_workflow"}).json()["items"]
    assert [(c["id"], c["credit_source"]) for c in worklist] == [(match["cell_id"], "qc_review")]

    # Undo QC unwinds the label with the fail, and the well comes back for review.
    assert client.post(f"/api/cells/{match['cell_id']}/qc/undo").status_code == 200
    assert client.get(f"/api/cells/{match['cell_id']}").json()["credit_source"] is None
    assert [w["key"] for w in _review(client)["pending"]] == ["TRACTION-RUN-2589|1|A1"]


def test_a_fail_started_in_runnx_also_takes_the_well_out_unlabelled(client, fake_mlwh):
    _loaded_run(client)
    fake_mlwh.add_well()
    match = _review(client)["pending"][0]["match"]
    cell = _confirm_fail(client, match, source=None)
    assert cell["credit_source"] is None
    assert _review(client)["already_failed"] == 1


def test_an_unknown_source_is_refused(client, fake_mlwh):
    _loaded_run(client)
    fake_mlwh.add_well()
    match = _review(client)["pending"][0]["match"]
    resp = client.post(f"/api/cells/{match['cell_id']}/qc/commit",
                       json={"verdict": "fail", "cell_use_id": match["cell_use_id"], "source": "elsewhere"})
    assert resp.status_code == 422


def test_logging_an_unmatched_well_as_a_case_takes_it_out(client, fake_mlwh):
    fake_mlwh.add_well(run="TRACTION-RUN-4040")
    key = _review(client)["pending"][0]["key"]
    body = {"summary": "Failed, SMRT cell - TRACTION-RUN-4040 P1 A1", "occurred_on": date.today().isoformat(),
            "mlwh_well_key": key}
    created = client.post("/api/pacbio-cases", json=body)
    assert created.status_code == 201, created.text
    assert created.json()["credit_source"] == "qc_review" and created.json()["mlwh_well_key"] == key

    review = _review(client)
    assert review["pending"] == [] and review["already_logged"] == 1
    # One well, one case.
    again = client.post("/api/pacbio-cases", json=body)
    assert again.status_code == 400 and "already logged" in again.json()["detail"]
    # Deleting the case (logged by mistake) puts the well back.
    assert client.delete(f"/api/pacbio-cases/{created.json()['id']}").status_code == 204
    assert [w["key"] for w in _review(client)["pending"]] == [key]


def test_a_hand_logged_case_has_no_source(client):
    created = client.post("/api/pacbio-cases", json={"summary": "Tray damaged", "occurred_on": date.today().isoformat()})
    assert created.json()["credit_source"] is None and created.json()["mlwh_well_key"] is None


def test_ignore_moves_a_well_to_the_ignored_list_and_restore_brings_it_back(client, fake_mlwh, db_session):
    fake_mlwh.add_well()
    key = _review(client)["pending"][0]["key"]

    assert client.post("/api/qc/review/ignore", json={"key": key, "reason": "   "}).status_code == 422
    resp = client.post("/api/qc/review/ignore", json={"key": key, "reason": " PacBio declined - pre-RunNx run ", "actor": "ab12"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["reason"] == "PacBio declined - pre-RunNx run" and resp.json()["ignored_by"] == "ab12"
    assert client.post("/api/qc/review/ignore", json={"key": key, "reason": "again"}).status_code == 409

    body = _review(client)
    assert body["pending"] == [] and [w["key"] for w in body["ignored"]] == [key]
    assert body["ignored"][0]["ignored"]["reason"] == "PacBio declined - pre-RunNx run"

    assert client.post("/api/qc/review/restore", json={"key": key}).status_code == 204
    assert [w["key"] for w in _review(client)["pending"]] == [key]
    assert client.post("/api/qc/review/restore", json={"key": key}).status_code == 404

    from app.models.audit import AuditLog

    actions = [r.action for r in db_session.query(AuditLog).filter_by(entity_type="qc_review").order_by(AuditLog.id)]
    assert actions == ["ignore_qc_review_well", "restore_qc_review_well"]


def test_ignore_rejects_something_that_is_not_a_well_key(client):
    assert client.post("/api/qc/review/ignore", json={"key": "TRACTION-RUN-1", "reason": "x"}).status_code == 422
