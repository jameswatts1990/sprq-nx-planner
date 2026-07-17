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


def _place(client, sample_id, run_date, slot_index=0, instrument="84047", run_time_hours=24):
    return client.post(
        "/api/cell-uses",
        json={
            "sample_id": sample_id,
            "instrument_serial": instrument,
            "run_date": run_date,
            "slot_index": slot_index,
            "cell_choice": {"mode": "new"},
            "run_time_hours": run_time_hours,
        },
    )


def test_list_tables_reports_columns_pk_and_row_counts(client):
    resp = client.get("/api/admin/tables")
    assert resp.status_code == 200
    tables = {t["name"]: t for t in resp.json()}

    assert "instruments" in tables
    assert "alembic_version" not in tables  # not part of Base.metadata, so never exposed

    instruments = tables["instruments"]
    assert instruments["primary_key"] == ["id"]
    assert "serial_number" in instruments["columns"]
    assert instruments["row_count"] == 4  # seeded by the client/db_session fixture


def test_list_rows_is_paginated_and_matches_seeded_data(client):
    resp = client.get("/api/admin/tables/instruments/rows", params={"page": 1, "page_size": 2})
    assert resp.status_code == 200
    body = resp.json()
    assert body["table"] == "instruments"
    assert body["total"] == 4
    assert body["page"] == 1
    assert body["page_size"] == 2
    assert len(body["rows"]) == 2

    page2 = client.get("/api/admin/tables/instruments/rows", params={"page": 2, "page_size": 2}).json()
    assert len(page2["rows"]) == 2
    assert {r["id"] for r in page2["rows"]}.isdisjoint({r["id"] for r in body["rows"]})


def test_list_rows_unknown_table_404s(client):
    resp = client.get("/api/admin/tables/not_a_real_table/rows")
    assert resp.status_code == 404


def test_delete_row_removes_it_then_404s_on_repeat(client):
    instruments = client.get("/api/admin/tables/instruments/rows", params={"page_size": 1}).json()
    row_id = instruments["rows"][0]["id"]

    resp = client.delete(f"/api/admin/tables/instruments/rows/{row_id}")
    assert resp.status_code == 204

    again = client.delete(f"/api/admin/tables/instruments/rows/{row_id}")
    assert again.status_code == 404

    remaining = client.get("/api/admin/tables/instruments/rows").json()
    assert remaining["total"] == 3


def test_delete_row_unknown_table_404s(client):
    resp = client.delete("/api/admin/tables/not_a_real_table/rows/1")
    assert resp.status_code == 404


def test_clear_table_deletes_all_rows_and_is_idempotent(client):
    resp = client.post("/api/admin/tables/instruments/clear")
    assert resp.status_code == 200
    body = resp.json()
    assert body["table"] == "instruments"
    assert body["deleted"] == 4

    remaining = client.get("/api/admin/tables/instruments/rows").json()
    assert remaining["total"] == 0

    again = client.post("/api/admin/tables/instruments/clear")
    assert again.status_code == 200
    assert again.json()["deleted"] == 0


def test_clearing_cycles_deletes_the_now_orphaned_run_batch(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    assert r1.status_code == 201, r1.text

    run_batches_before = client.get("/api/admin/tables/run_batches/rows").json()["total"]
    assert run_batches_before == 1

    resp = client.post("/api/admin/tables/cycles/clear")
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 1

    # RunBatch has no FK back to Cycle, so nothing would cascade this direction on its
    # own - without the explicit cleanup, this row would survive as an orphan and the
    # next placement into (84047, mon) would 500 on RunBatch's own unique constraint.
    run_batches_after = client.get("/api/admin/tables/run_batches/rows").json()["total"]
    assert run_batches_after == 0

    # Placing into that exact (instrument, day) again must succeed cleanly, not 500. Slot 4
    # rather than slot 0 - the raw table-clear bypasses cleanup_tray_if_fully_unused (see
    # cell_service.py), so the original tray's Cell rows (still status "open") are
    # orphaned but left behind occupying wells A01-D01; what this test actually checks is
    # the RunBatch/Cycle recreation path, not well A01 specifically, so slot 4 (a wholly
    # untouched tray box) proves the same point without hitting that separate, accepted
    # rough edge of the dev-only Admin table-clear tool.
    retry = _place(client, _sid(client, "A1"), mon, slot_index=4)
    assert retry.status_code == 201, retry.text


def test_clearing_cycles_reverts_the_orphaned_samples_to_backlog(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    assert r1.status_code == 201, r1.text

    sample_id = _sid(client, "A1")
    before = client.get(f"/api/samples/{sample_id}").json()
    assert before["status"] == "scheduled"

    resp = client.post("/api/admin/tables/cycles/clear")
    assert resp.status_code == 200

    # cell_uses cascades away with its cycle (FK-enforced now), but nothing about that
    # cascade knows to revert the sample's status - without the explicit reconciliation
    # it would stay stuck as "scheduled" forever with no cell_use to back it up.
    after = client.get(f"/api/samples/{sample_id}").json()
    assert after["status"] == "backlog"


def test_deleting_a_single_cell_use_row_reverts_its_sample_to_backlog(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    assert r1.status_code == 201, r1.text
    cell_use_id = r1.json()["stages"][0]["cell_use_id"]
    cell_id = r1.json()["stages"][0]["cell_id"]

    resp = client.delete(f"/api/admin/tables/cell_uses/rows/{cell_use_id}")
    assert resp.status_code == 204

    sample_id = _sid(client, "A1")
    sample = client.get(f"/api/samples/{sample_id}").json()
    assert sample["status"] == "backlog"

    # The cell had no other uses - same "was only ever a placeholder" rule as
    # remove_sample applies, so it must not survive as an orphan "open, 0/3" cell.
    assert client.get(f"/api/cells/{cell_id}").status_code == 404


def test_deleting_a_run_batch_row_cascades_and_reconciles_its_samples(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    assert r1.status_code == 201, r1.text
    _place(client, _sid(client, "A2"), mon, slot_index=1)
    run_batch_id = client.get("/api/admin/tables/run_batches/rows").json()["rows"][0]["id"]

    resp = client.delete(f"/api/admin/tables/run_batches/rows/{run_batch_id}")
    assert resp.status_code == 204

    for external_id in ("A1", "A2"):
        sample = client.get(f"/api/samples/{_sid(client, external_id)}").json()
        assert sample["status"] == "backlog"
    assert client.get("/api/admin/tables/cell_uses/rows").json()["total"] == 0


def test_deleting_a_cell_still_in_use_is_blocked_not_orphaned(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    assert r1.status_code == 201, r1.text
    cell_id = r1.json()["stages"][0]["cell_id"]

    # Without FK enforcement this would silently succeed and leave cell_uses.cell_id
    # dangling; with it, the DB itself refuses the delete.
    resp = client.delete(f"/api/admin/tables/cells/rows/{cell_id}")
    assert resp.status_code == 409


def test_deleting_a_sample_still_in_use_is_blocked_not_orphaned(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "A1"), mon, slot_index=0)
    assert r1.status_code == 201, r1.text
    sample_id = _sid(client, "A1")

    resp = client.delete(f"/api/admin/tables/samples/rows/{sample_id}")
    assert resp.status_code == 409
