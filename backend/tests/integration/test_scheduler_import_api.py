import csv
import io

HEADER = [
    "Pool ID",
    "Portion of SMRT Cell",
    "Complex Batch ID",
    "Sanger Sample ID",
    "Priority",
    "Target Loading Concentration (pM)",
]


def _sheet(rows: list[list[str]]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(HEADER)
    writer.writerows(rows)
    return buf.getvalue()


def _assemble(columns: list[str], rows: list[list[str]]) -> str:
    """Rebuild the import CSV from selected pool rows, as the frontend does before commit."""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(columns)
    writer.writerows(rows)
    return buf.getvalue()


def test_scheduler_convert_pools_by_id_then_imports_end_to_end(client):
    sheet = _sheet(
        [
            ["POOL-1", "1", "bc01", "DTOL1", "High", "300"],
            ["POOL-2", "0.5", "bc02", "DTOL2", "Low", "250"],
            ["", "0.5", "bc03", "DTOL3", "", ""],  # blank Pool ID continues POOL-2
        ]
    )

    # 1) convert (non-committing): three sample rows -> two pools, both whole cells
    conv = client.post("/api/imports/scheduler-convert", json={"raw_text": sheet})
    assert conv.status_code == 200, conv.text
    body = conv.json()
    assert body["pool_count"] == 2
    assert body["review_count"] == 0
    assert body["source_row_count"] == 3
    assert "Portion of SMRT Cell" not in body["columns"]
    assert {p["pool_id"] for p in body["pools"]} == {"POOL-1", "POOL-2"}
    # nothing written yet
    assert client.get("/api/samples", params={"status": "backlog"}).json()["total"] == 0

    # 2) the assembled CSV auto-maps in the ordinary preview
    assembled = _assemble(body["columns"], [p["row"] for p in body["pools"]])
    prev = client.post("/api/imports/preview", json={"raw_text": assembled}).json()
    assert prev["unmatched_required"] == []
    column_map = prev["suggested_map"]

    # 3) commit through the normal import path
    result = client.post(
        "/api/imports",
        json={"raw_text": assembled, "has_header": True, "column_map": column_map},
    ).json()
    assert result["imported_count"] == 2

    backlog = client.get("/api/samples", params={"status": "backlog"}).json()["items"]
    by_id = {s["pool_id"]: s for s in backlog}
    assert set(by_id) == {"POOL-1", "POOL-2"}
    # POOL-2 combined the two half-cell rows' barcodes
    assert by_id["POOL-2"]["barcodes"] == ["bc02", "bc03"]


def test_scheduler_review_pool_is_excluded_unless_authorised(client):
    """A pool that isn't a whole cell is returned as status='review'; the frontend imports it
    only when the user authorises it (by including its row in the committed CSV)."""
    sheet = _sheet(
        [
            ["WHOLE", "1", "bc1", "DTOL1", "", ""],
            ["HALF", "0.5", "bc2", "DTOL2", "", ""],  # only half a cell -> review
        ]
    )
    body = client.post("/api/imports/scheduler-convert", json={"raw_text": sheet}).json()
    assert body["review_count"] == 1
    status_by_id = {p["pool_id"]: p["status"] for p in body["pools"]}
    assert status_by_id == {"WHOLE": "ok", "HALF": "review"}

    # Commit only the whole-cell pool (user left the review pool un-ticked).
    ok_rows = [p["row"] for p in body["pools"] if p["status"] == "ok"]
    assembled = _assemble(body["columns"], ok_rows)
    column_map = client.post("/api/imports/preview", json={"raw_text": assembled}).json()["suggested_map"]
    result = client.post(
        "/api/imports",
        json={"raw_text": assembled, "has_header": True, "column_map": column_map},
    ).json()
    assert result["imported_count"] == 1
    backlog = client.get("/api/samples", params={"status": "backlog"}).json()["items"]
    assert {s["pool_id"] for s in backlog} == {"WHOLE"}

    # Authorising the review pool imports it too (its row is included this time).
    all_rows = [p["row"] for p in body["pools"]]
    assembled_all = _assemble(body["columns"], all_rows)
    result2 = client.post(
        "/api/imports",
        json={"raw_text": assembled_all, "has_header": True, "column_map": column_map},
    ).json()
    assert result2["imported_count"] == 2


def test_scheduler_convert_rejects_a_non_scheduler_file_with_400(client):
    resp = client.post("/api/imports/scheduler-convert", json={"raw_text": "Foo,Bar\n1,2"})
    assert resp.status_code == 400
    assert "Pool ID" in resp.json()["detail"]
