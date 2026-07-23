import csv
import io

from app.engine.tracker_columns import (
    K_BARCODES,
    K_PRIORITY,
    K_SANGER,
    K_STATUS,
    K_TRACTION_ID,
    TRACKER_COLUMNS,
    TRACKER_HEADER,
)


def _tracker_csv(rows: list[dict]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(TRACKER_HEADER)
    for row in rows:
        writer.writerow([row.get(key, "") if key else "" for _, key in TRACKER_COLUMNS])
    return buf.getvalue()


def test_import_tracker_layout_lands_pending_rows_in_backlog(client):
    text = _tracker_csv(
        [
            {K_TRACTION_ID: "TRAC-2-26256", K_BARCODES: "bc2074", K_SANGER: "DTOL1", K_PRIORITY: "High", K_STATUS: "Pending"},
            {K_TRACTION_ID: "TRAC-2-26279", K_BARCODES: "bc2094 bc2095", K_STATUS: "Pending"},
            {K_TRACTION_ID: "TRAC-2-25815", K_BARCODES: "bc2044, bc2052", K_STATUS: "Loaded"},  # skipped
            {},  # separator row, silently skipped
        ]
    )

    resp = client.post("/api/imports", json={"raw_text": text, "actor": "tester"})
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["imported_count"] == 2
    assert {s["external_id"] for s in body["samples"]} == {"TRAC-2-26256", "TRAC-2-26279"}
    assert {s["status"] for s in body["samples"]} == {"backlog"}
    assert any("sequencing-tracker layout" in w for w in body["warnings"])
    assert any("TRAC-2-25815" in w and "already on instrument" in w for w in body["warnings"])

    backlog = client.get("/api/samples", params={"status": "backlog"}).json()
    assert {s["external_id"] for s in backlog["items"]} == {"TRAC-2-26256", "TRAC-2-26279"}


def test_default_format_still_imports_unchanged(client):
    # Regression: the two-column paste path is untouched by the tracker dispatch.
    resp = client.post("/api/imports", json={"raw_text": "sample,barcodes\nA,bc1\nB,bc2"}).json()
    assert resp["imported_count"] == 2
    assert not any("sequencing-tracker" in w for w in resp["warnings"])
