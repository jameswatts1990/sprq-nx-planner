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


def test_scheduler_convert_pools_rows_then_imports_end_to_end(client):
    sheet = _sheet(
        [
            ["POOL-1", "1", "bc01", "DTOL1", "High", "300"],
            ["POOL-2", "0.5", "bc02", "DTOL2", "Low", "250"],
            ["", "0.5", "bc03", "DTOL3", "", ""],
        ]
    )

    # 1) convert (non-committing): three sample rows -> two containers
    conv = client.post("/api/imports/scheduler-convert", json={"raw_text": sheet})
    assert conv.status_code == 200, conv.text
    body = conv.json()
    assert body["pool_count"] == 2
    assert body["source_row_count"] == 3
    # nothing written yet
    assert client.get("/api/samples", params={"status": "backlog"}).json()["total"] == 0

    # 2) the converted CSV auto-maps in the ordinary preview
    converted = body["csv"]
    prev = client.post("/api/imports/preview", json={"raw_text": converted}).json()
    assert prev["unmatched_required"] == []
    column_map = prev["suggested_map"]

    # 3) commit through the normal import path
    result = client.post(
        "/api/imports",
        json={"raw_text": converted, "has_header": True, "column_map": column_map},
    ).json()
    assert result["imported_count"] == 2

    backlog = client.get("/api/samples", params={"status": "backlog"}).json()["items"]
    by_id = {s["external_id"]: s for s in backlog}
    assert set(by_id) == {"POOL-1", "POOL-2"}
    # POOL-2 combined the two half-cell rows' barcodes
    assert by_id["POOL-2"]["barcodes"] == ["bc02", "bc03"]


def test_scheduler_convert_rejects_a_non_scheduler_file_with_400(client):
    resp = client.post("/api/imports/scheduler-convert", json={"raw_text": "Foo,Bar\n1,2"})
    assert resp.status_code == 400
    assert "Pool ID" in resp.json()["detail"]
