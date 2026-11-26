"""GET/PUT /api/settings/issue-report and /api/settings/qc - the issue report's lab-specific values
(blank until set: the repo is public, so no team or person is named in code) and the QC overdue limit."""


def _audit_actions(client) -> list[str]:
    rows = client.get("/api/admin/tables/audit_log/rows", params={"page_size": 50}).json()["rows"]
    return [row["action"] for row in rows]


def test_issue_report_starts_blank(client):
    resp = client.get("/api/settings/issue-report")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"team": "", "equipment_owner": "", "manager": ""}


def test_issue_report_update_trims_merges_clears_and_audits(client):
    resp = client.put("/api/settings/issue-report", json={"team": "  Sequencing_Ops  ", "manager": "A Manager"})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"team": "Sequencing_Ops", "equipment_owner": "", "manager": "A Manager"}
    # A later partial update keeps the untouched values; "" clears one.
    resp = client.put("/api/settings/issue-report", json={"equipment_owner": "Lab_Equipment", "manager": ""})
    assert resp.json() == {"team": "Sequencing_Ops", "equipment_owner": "Lab_Equipment", "manager": ""}
    assert client.get("/api/settings/issue-report").json()["equipment_owner"] == "Lab_Equipment"
    assert "update_issue_report_settings" in _audit_actions(client)


def test_issue_report_rejects_overlong_values(client):
    resp = client.put("/api/settings/issue-report", json={"team": "x" * 121})
    assert resp.status_code == 422
    assert "Team" in resp.json()["detail"]
    assert client.get("/api/settings/issue-report").json()["team"] == ""


def test_qc_overdue_days_defaults_to_30_and_updates(client):
    assert client.get("/api/settings/qc").json() == {"overdue_days": 30, "review_lookback_days": 90}
    resp = client.put("/api/settings/qc", json={"overdue_days": 45})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"overdue_days": 45, "review_lookback_days": 90}
    assert client.get("/api/settings/qc").json() == {"overdue_days": 45, "review_lookback_days": 90}
    assert "update_qc_settings" in _audit_actions(client)


def test_qc_overdue_days_rejects_out_of_range(client):
    for bad in (0, 366, -5):
        assert client.put("/api/settings/qc", json={"overdue_days": bad}).status_code == 422
    assert client.put("/api/settings/qc", json={"overdue_days": 1.5}).status_code == 422
    assert client.get("/api/settings/qc").json()["overdue_days"] == 30


def test_qc_review_lookback_defaults_to_90_updates_alone_and_rejects_out_of_range(client):
    resp = client.put("/api/settings/qc", json={"review_lookback_days": 30})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"overdue_days": 30, "review_lookback_days": 30}
    for bad in (0, 731):
        assert client.put("/api/settings/qc", json={"review_lookback_days": bad}).status_code == 422
    # A bad value in a combined update saves neither.
    assert client.put("/api/settings/qc", json={"overdue_days": 10, "review_lookback_days": 0}).status_code == 422
    assert client.get("/api/settings/qc").json() == {"overdue_days": 30, "review_lookback_days": 30}
