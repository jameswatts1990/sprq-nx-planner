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
