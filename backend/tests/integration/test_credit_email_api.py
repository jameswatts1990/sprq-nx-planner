"""GET/PUT /api/settings/credit-email — the editable PacBio credit-email template."""


def test_credit_email_starts_at_built_in_defaults(client):
    resp = client.get("/api/settings/credit-email")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) == {"to", "cc", "subject", "body"}
    # Defaults carry the variable tokens the frontend fills in.
    assert "<run>" in body["subject"]
    assert "<sample name>" in body["body"]
    assert "<reimbursement>" in body["body"]
    assert body["to"].startswith("Pacific Biosciences")


def test_update_credit_email_persists_and_merges(client):
    resp = client.put(
        "/api/settings/credit-email",
        json={"subject": "Credit request: <case number>", "cc": "  qa@sanger.ac.uk  "},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["subject"] == "Credit request: <case number>"
    assert body["cc"] == "qa@sanger.ac.uk"  # trimmed
    # Untouched fields keep their defaults, and the change persists across reads.
    assert "<sample name>" in body["body"]
    assert client.get("/api/settings/credit-email").json()["subject"] == "Credit request: <case number>"


def test_credit_email_body_beyond_255_chars_round_trips(client):
    """Guards the value-column widening (String(255) -> Text): a realistic multi-line body
    exceeds 255 chars and must survive storage intact on Postgres."""
    long_body = "Dear PacBio,\n\n" + ("Details about sample <sample name> on run <run>. " * 12)
    assert len(long_body) > 255
    resp = client.put("/api/settings/credit-email", json={"body": long_body})
    assert resp.status_code == 200, resp.text
    assert resp.json()["body"] == long_body
    assert client.get("/api/settings/credit-email").json()["body"] == long_body


def test_update_credit_email_writes_audit_log(client):
    client.put("/api/settings/credit-email", json={"to": "support@pacificbiosciences.com"})
    logs = client.get("/api/admin/tables/audit_log/rows", params={"page_size": 50}).json()["rows"]
    assert any(row["action"] == "update_credit_email" for row in logs)
