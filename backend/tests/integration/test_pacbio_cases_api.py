"""PacBio credit cases logged WITHOUT a RunNx cell (/api/pacbio-cases): create with the minimum
(summary + date) or with an existing PacBio case number, the same stage rules as a cell's case,
full-replace edit, audited delete, and that they count in the Stats credit funnel - while never
touching any cell."""
from datetime import date


def _instrument_id(client, serial: str) -> int:
    return next(i["id"] for i in client.get("/api/instruments").json() if i["serial_number"] == serial)


def _create(client, **overrides):
    body = {"summary": "Untracked cell failed on loading", "occurred_on": date.today().isoformat()} | overrides
    return client.post("/api/pacbio-cases", json=body)


def _audit_actions(db_session, case_id: int) -> list[str]:
    from app.models.audit import AuditLog

    rows = db_session.query(AuditLog).filter_by(entity_type="pacbio_case", entity_id=case_id).order_by(AuditLog.id)
    return [r.action for r in rows]


def test_create_minimal_case_starts_at_needs_report_and_touches_no_cell(client, db_session):
    r = _create(client, summary="  Tray damaged on arrival  ")
    assert r.status_code == 201, r.text
    case = r.json()
    assert case["summary"] == "Tray damaged on arrival"
    assert case["pacbio_reported_at"] is None
    assert case["instrument_serial"] is None
    assert [c["id"] for c in client.get("/api/pacbio-cases").json()] == [case["id"]]
    assert client.get("/api/cells").json()["total"] == 0
    assert _audit_actions(db_session, case["id"]) == ["create_pacbio_case"]


def test_create_with_context_and_case_number_skips_needs_report(client):
    r = _create(
        client,
        instrument_id=_instrument_id(client, "84098"),
        run_name="TRACTION-RUN-77",
        pool_id="TRAC-2-123",
        expected_acquisitions=3,
        pacbio_case_number=" CS-0042 ",
        credit_notes="Raised by phone",
    )
    assert r.status_code == 201, r.text
    case = r.json()
    assert case["instrument_serial"] == "84098"
    assert case["pacbio_case_number"] == "CS-0042"
    assert case["pacbio_reported_at"] is not None
    assert case["expected_acquisitions"] == 3
    assert case["credit_notes"] == "Raised by phone"


def test_create_rejects_bad_details(client):
    assert _create(client, summary="   ").status_code == 400
    assert _create(client, summary="x" * 201).status_code == 400
    assert _create(client, expected_acquisitions=0).status_code == 400
    assert _create(client, instrument_id=9999).status_code == 400
    assert client.get("/api/pacbio-cases").json() == []


def test_stage_rules_match_a_cells_case(client, db_session):
    case_id = _create(client).json()["id"]
    base = f"/api/pacbio-cases/{case_id}"
    # Confirm/receive both need the case raised with PacBio first.
    assert client.post(f"{base}/confirm-credit", json={"acquisitions": 2}).status_code == 409
    assert client.post(f"{base}/receive-credit", json={}).status_code == 409
    assert client.post(f"{base}/report-to-pacbio", json={"case_number": "  "}).status_code == 409

    assert client.post(f"{base}/report-to-pacbio", json={"case_number": "CS-9"}).status_code == 200
    first = client.post(f"{base}/internal-report", json={"report_id": "26_NC_S_010"}).json()
    # A later edit corrects the ID but keeps the original raised-at time.
    again = client.post(f"{base}/internal-report", json={"report_id": "26_NC_S_011"}).json()
    assert again["internal_report_id"] == "26_NC_S_011"
    assert again["internal_report_at"] == first["internal_report_at"]

    assert client.post(f"{base}/confirm-credit", json={"acquisitions": 0}).status_code == 409
    confirmed = client.post(f"{base}/confirm-credit", json={"acquisitions": 2})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["credit_acquisitions"] == 2
    noted = client.post(f"{base}/credit-notes", json={"notes": "Credit memo 881"})
    assert noted.json()["credit_notes"] == "Credit memo 881"
    assert client.post(f"{base}/receive-credit", json={}).json()["credit_received_at"] is not None

    assert _audit_actions(db_session, case_id) == [
        "create_pacbio_case",
        "report_case_to_pacbio",
        "set_case_internal_report",
        "set_case_internal_report",
        "confirm_case_credit",
        "set_case_credit_notes",
        "receive_case_credit",
    ]


def test_edit_is_a_full_replace_that_can_clear_fields(client, db_session):
    case_id = _create(client, run_name="RUN-1", instrument_id=_instrument_id(client, "84047")).json()["id"]
    r = client.put(
        f"/api/pacbio-cases/{case_id}",
        json={"summary": "Corrected summary", "occurred_on": "2026-09-01", "pool_id": "POOL-9"},
    )
    assert r.status_code == 200, r.text
    case = r.json()
    assert case["summary"] == "Corrected summary"
    assert case["occurred_on"] == "2026-09-01"
    assert case["run_name"] is None
    assert case["instrument_id"] is None
    assert case["pool_id"] == "POOL-9"
    blank = client.put(f"/api/pacbio-cases/{case_id}", json={"summary": "", "occurred_on": "2026-09-01"})
    assert blank.status_code == 400

    from app.models.audit import AuditLog

    edit = db_session.query(AuditLog).filter_by(entity_type="pacbio_case", action="update_pacbio_case").one()
    assert set(edit.details_json) == {"summary", "occurred_on", "instrument_id", "run_name", "pool_id"}


def test_delete_removes_the_case_and_keeps_it_in_the_audit_trail(client, db_session):
    case_id = _create(client, pacbio_case_number="CS-DEL").json()["id"]
    assert client.delete(f"/api/pacbio-cases/{case_id}").status_code == 204
    assert client.get("/api/pacbio-cases").json() == []
    assert client.delete(f"/api/pacbio-cases/{case_id}").status_code == 404

    from app.models.audit import AuditLog

    entry = db_session.query(AuditLog).filter_by(entity_type="pacbio_case", action="delete_pacbio_case").one()
    assert entry.details_json["pacbio_case_number"] == "CS-DEL"


def test_cases_without_a_cell_count_in_the_stats_credit_funnel(client):
    on_84047 = _instrument_id(client, "84047")
    _create(client)  # needs report, no instrument
    _create(client, instrument_id=on_84047, pacbio_case_number="CS-1")  # reported, awaiting credit
    received = _create(client, pacbio_case_number="CS-2").json()["id"]
    client.post(f"/api/pacbio-cases/{received}/receive-credit", json={})

    funnel = client.get("/api/stats").json()["failures"]["credit_funnel"]
    assert funnel == {"needs_report": 1, "reported": 2, "awaiting": 1, "received": 1}
    headline = client.get("/api/stats").json()["headline"]
    assert headline["cells_awaiting_credit"] == 1
    assert headline["credits_received"] == 1

    # An instrument filter keeps only the case logged against that instrument.
    scoped = client.get("/api/stats", params={"instrument_serial": "84047"}).json()["failures"]["credit_funnel"]
    assert scoped == {"needs_report": 0, "reported": 1, "awaiting": 1, "received": 0}


def test_create_backfills_every_stage_the_lab_already_has(client, db_session):
    r = _create(
        client,
        pacbio_case_number="00316913",
        internal_report_id="26_NC_S_040",
        credit_acquisitions=3,
        credit_received=True,
        credit_owner=" jw24 ",
    )
    assert r.status_code == 201, r.text
    case = r.json()
    assert case["pacbio_reported_at"] and case["internal_report_at"]
    assert case["pacbio_credit_confirmed_at"] and case["credit_received_at"]
    assert case["credit_acquisitions"] == 3
    assert case["credit_owner"] == "jw24"
    assert _audit_actions(db_session, case["id"]) == ["create_pacbio_case"]


def test_create_backfill_refuses_stages_out_of_order(client):
    assert _create(client, credit_acquisitions=2).status_code == 400  # credited, never reported
    assert _create(client, credit_received=True).status_code == 400  # received, never reported
    assert _create(client, pacbio_case_number="CS-1", credit_acquisitions=0).status_code == 400
    assert client.get("/api/pacbio-cases").json() == []


def test_owner_is_set_trimmed_and_cleared(client):
    case_id = _create(client).json()["id"]
    base = f"/api/pacbio-cases/{case_id}/credit-owner"
    assert client.post(base, json={"owner": "  Paola V  "}).json()["credit_owner"] == "Paola V"
    assert client.post(base, json={"owner": "x" * 121}).status_code == 409
    assert client.post(base, json={"owner": "   "}).json()["credit_owner"] is None


def test_correcting_a_done_stage_keeps_when_it_happened(client):
    case_id = _create(client).json()["id"]
    base = f"/api/pacbio-cases/{case_id}"
    reported = client.post(f"{base}/report-to-pacbio", json={"case_number": "0031691"}).json()
    fixed = client.post(f"{base}/report-to-pacbio", json={"case_number": "00316913"}).json()
    assert fixed["pacbio_case_number"] == "00316913"
    assert fixed["pacbio_reported_at"] == reported["pacbio_reported_at"]

    confirmed = client.post(f"{base}/confirm-credit", json={"acquisitions": 2}).json()
    recount = client.post(f"{base}/confirm-credit", json={"acquisitions": 3}).json()
    assert recount["credit_acquisitions"] == 3
    assert recount["pacbio_credit_confirmed_at"] == confirmed["pacbio_credit_confirmed_at"]
