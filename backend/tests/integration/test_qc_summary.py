"""GET /api/qc/summary - the QC nav item's counts - and the overdue rule it shares with the QC page:
needs-report and awaiting counts over cells' own cases plus cases logged without a cell, overdue
measured from the latest completed step against the qc.overdue_days setting, and total_action
counting each case that needs a report or is overdue once."""
from datetime import date, timedelta

from app.models.cell import Cell
from app.services.qc_summary import cell_failure_at, compute_qc_summary
from app.timeutil import utcnow
from tests.integration._qc_helpers import qc_commit
from tests.integration.test_cell_qc_and_credit_api import (
    _past_weekday,
    _place,
    _sid,
    _stages,
)


def _summary(client) -> dict:
    r = client.get("/api/qc/summary")
    assert r.status_code == 200, r.text
    return r.json()


def _no_cell_case(client, days_ago: int, **extra) -> dict:
    occurred = (date.today() - timedelta(days=days_ago)).isoformat()
    r = client.post("/api/pacbio-cases", json={"summary": "Untracked cell failed", "occurred_on": occurred} | extra)
    assert r.status_code == 201, r.text
    return r.json()


def _stopped_cell(client, pool_id: str) -> int:
    client.post("/api/imports", json={"raw_text": f"sample,barcodes\n{pool_id},bc{pool_id}"})
    r = _place(client, _sid(client, pool_id), _past_weekday(), 0, {"mode": "new"})
    stage = _stages(r.json())[0]
    assert client.patch(f"/api/cycles/{r.json()['run_id']}", json={"status": "running"}).status_code == 200
    qc_commit(client, stage["cell_id"], "fail_and_stop", stage["cell_use_id"], {_sid(client, pool_id): "lost"})
    return stage["cell_id"]


def test_empty_summary(client):
    assert _summary(client) == {"needs_report": 0, "awaiting_credit": 0, "overdue": 0, "total_action": 0}


def test_counts_cell_and_no_cell_cases_and_dedupes_total_action(client):
    _stopped_cell(client, "S1")  # needs report, fresh
    _no_cell_case(client, days_ago=40)  # needs report AND overdue -> one action
    _no_cell_case(client, days_ago=2, pacbio_case_number="CS-1")  # awaiting, on time
    assert _summary(client) == {"needs_report": 2, "awaiting_credit": 1, "overdue": 1, "total_action": 2}


def test_overdue_waits_from_the_latest_completed_step(client):
    case = _no_cell_case(client, days_ago=40)
    assert _summary(client)["overdue"] == 1
    # Reporting it today restarts the clock: awaiting PacBio, not overdue, no longer an action.
    assert client.post(f"/api/pacbio-cases/{case['id']}/report-to-pacbio", json={"case_number": "CS-2"}).status_code == 200
    assert _summary(client) == {"needs_report": 0, "awaiting_credit": 1, "overdue": 0, "total_action": 0}


def test_overdue_limit_follows_the_setting(client):
    _no_cell_case(client, days_ago=40)
    assert _summary(client)["overdue"] == 1
    assert client.put("/api/settings/qc", json={"overdue_days": 60}).status_code == 200
    assert _summary(client)["overdue"] == 0


def test_cell_case_overdue_boundary_is_whole_days_past_the_limit(client, db_session):
    cell_id = _stopped_cell(client, "B1")
    failure_at = cell_failure_at(db_session.get(Cell, cell_id))
    # 30 whole days at a 30-day limit is not yet overdue; 31 is.
    assert compute_qc_summary(db_session, now=failure_at + timedelta(days=30, hours=23)).overdue == 0
    assert compute_qc_summary(db_session, now=failure_at + timedelta(days=31)).overdue == 1


def test_received_case_is_settled_only_once_every_step_is_done(client, db_session):
    case = _no_cell_case(client, days_ago=60, pacbio_case_number="CS-3")
    assert client.post(f"/api/pacbio-cases/{case['id']}/receive-credit", json={}).status_code == 200
    late = compute_qc_summary(db_session, now=utcnow() + timedelta(days=40))
    # Received but missing its internal report: still open on the QC page, so it can go overdue.
    assert late.overdue == 1 and late.awaiting_credit == 0
