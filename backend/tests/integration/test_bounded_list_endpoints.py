"""List endpoints page in SQL (or at least cap their page size), so a long-lived lab database
can't make one request load every row: the audit log, import batches, the cells lists, and the
grid feed's duplicate markers."""
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import event

from app.models.audit import AuditLog


def _audit(db_session, at: datetime, action: str, actor: str = "ann", details: dict | None = None) -> None:
    db_session.add(
        AuditLog(at=at, actor=actor, action=action, entity_type="sample", entity_id=7, details_json=details or {})
    )


def _seed_audit(db_session) -> None:
    _audit(db_session, datetime(2026, 11, 2, 9, tzinfo=UTC), "place_sample", details={"pool_id": "POOL-A"})
    _audit(db_session, datetime(2026, 11, 3, 23, 30, tzinfo=UTC), "move_sample", actor="bob")
    _audit(db_session, datetime(2026, 11, 4, 0, 30, tzinfo=UTC), "remove_sample")
    db_session.commit()


def _actions(client, **params) -> list[str]:
    r = client.get("/api/audit-log", params=params)
    assert r.status_code == 200, r.text
    return [row["action"] for row in r.json()["items"]]


def test_audit_date_to_includes_its_whole_last_day(client, db_session):
    _seed_audit(db_session)
    # 23:30 on the 3rd used to fall outside date_to=3rd (compared against midnight).
    assert _actions(client, date_from="2026-11-03", date_to="2026-11-03") == ["move_sample"]
    assert _actions(client, date_to="2026-11-03") == ["move_sample", "place_sample"]


def test_audit_action_filter_takes_one_action_or_a_group(client, db_session):
    _seed_audit(db_session)
    assert _actions(client, action="move_sample") == ["move_sample"]
    assert _actions(client, action="place_sample, remove_sample") == ["remove_sample", "place_sample"]


def test_audit_q_matches_actor_action_and_details(client, db_session):
    _seed_audit(db_session)
    assert _actions(client, q="BOB") == ["move_sample"]
    assert _actions(client, q="remove") == ["remove_sample"]
    assert _actions(client, q="pool-a") == ["place_sample"]
    assert _actions(client, q="nothing-like-this") == []


def test_audit_pages_in_sql_newest_first(client, db_session):
    start = datetime(2026, 11, 1, tzinfo=UTC)
    for i in range(5):
        _audit(db_session, start + timedelta(hours=i), f"a{i}")
    db_session.commit()
    first = client.get("/api/audit-log", params={"page": 1, "page_size": 2}).json()
    second = client.get("/api/audit-log", params={"page": 2, "page_size": 2}).json()
    assert first["total"] == second["total"] == 5
    assert [r["action"] for r in first["items"]] == ["a4", "a3"]
    assert [r["action"] for r in second["items"]] == ["a2", "a1"]
    assert client.get("/api/audit-log", params={"page_size": 201}).status_code == 422


def test_imports_list_pages_in_sql_without_the_pasted_file(client):
    for i in range(3):
        client.post("/api/imports", json={"raw_text": f"sample,barcodes\nIMP{i},bc{i}"})
    body = client.get("/api/imports", params={"page": 1, "page_size": 2}).json()
    assert body["total"] == 3
    assert len(body["items"]) == 2
    assert "raw_text" not in body["items"][0]
    # The single-batch endpoint still returns the pasted file.
    assert "IMP" in client.get(f"/api/imports/{body['items'][0]['id']}").json()["raw_text"]
    assert client.get("/api/imports", params={"page": 0}).status_code == 422


def test_cells_lists_cap_the_page_size(client):
    for path in ("/api/cells", "/api/cells/trays"):
        assert client.get(path, params={"page_size": 1000}).status_code == 200
        assert client.get(path, params={"page_size": 1001}).status_code == 422
        assert client.get(path, params={"page": 0}).status_code == 422


def _weekdays(n: int) -> list[str]:
    d = date.today() + timedelta(days=1)
    while d.weekday() != 0:
        d += timedelta(days=1)
    out: list[str] = []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def test_grid_feed_fetches_duplicate_markers_once_for_all_runs(client, db_session):
    """GET /api/cycles used to run serializers.duplicate_groups once per run (an N+1)."""
    pools = [f"DUP{i}" for i in range(4)]
    client.post("/api/imports", json={"raw_text": "sample,barcodes\n" + "\n".join(f"{p},bc{p}" for p in pools)})
    samples = {s["pool_id"]: s["id"] for s in client.get("/api/samples", params={"page_size": 200}).json()["items"]}
    (day,) = _weekdays(1)
    for pool, serial in zip(pools, ("84047", "84098", "84093", "84309"), strict=True):
        r = client.post(
            "/api/cell-uses",
            json={
                "sample_id": samples[pool],
                "instrument_serial": serial,
                "load_date": day,
                "slot_index": 0,
                "run_time_hours": 24,
                "cell_choice": {"mode": "new"},
            },
        )
        assert r.status_code == 201, r.text

    statements: list[str] = []

    def _record(conn, cursor, statement, *args):
        statements.append(statement)

    engine = db_session.get_bind()
    event.listen(engine, "before_cursor_execute", _record)
    try:
        runs = client.get("/api/cycles", params={"date_from": day, "date_to": day}).json()
    finally:
        event.remove(engine, "before_cursor_execute", _record)

    assert len(runs) == 4
    # duplicate_groups' query is the only one ordering samples by Pool ID.
    assert sum("ORDER BY samples.pool_id" in s for s in statements) == 1
