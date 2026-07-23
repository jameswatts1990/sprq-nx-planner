import csv
import io
from datetime import date, timedelta

from app.engine.tracker_columns import TRACKER_HEADER


def _past_weekday() -> str:
    d = date.today() - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d.isoformat()


def _sid(client, external_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["external_id"] == external_id)


def _rows(csv_text: str) -> list[list[str]]:
    return list(csv.reader(io.StringIO(csv_text)))


def test_export_header_is_exact_56_column_layout(client):
    resp = client.get("/api/schedule/export.csv")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    rows = _rows(resp.text)
    assert rows[0] == TRACKER_HEADER  # verbatim incl. blanks + embedded newlines


def test_export_fills_p1_columns_for_a_loaded_run(client):
    client.post(
        "/api/imports",
        json={
            "raw_text": (
                "Sample,Sanger Sample IDs,Barcodes,Actual OPLC,Target OPLC,Priority,"
                "CCS Output Include Kinetics Information\n"
                'TRAC-2-9001,DTOL1,"bc2044 bc2052",250,300,High,Yes'
            )
        },
    )
    past = _past_weekday()
    placed = client.post(
        "/api/cell-uses",
        json={
            "sample_id": _sid(client, "TRAC-2-9001"),
            "instrument_serial": "84047",
            "run_date": past,
            "slot_index": 0,
            "cell_choice": {"mode": "new"},
            "run_time_hours": 24,
        },
    )
    assert placed.status_code == 201, placed.text
    cycle_id = placed.json()["cycle_id"]
    client.patch(f"/api/cycles/{cycle_id}", json={"status": "running", "run_name": "TRACTION-RUN-TEST"})

    resp = client.get("/api/schedule/export.csv", params={"date_from": past, "date_to": past})
    rows = _rows(resp.text)
    assert len(rows) == 2  # header + one well
    row = rows[1]

    dd = date.fromisoformat(past).strftime("%d/%m/%Y")
    assert row[0] == dd  # Date run started
    assert row[1] == "TRACTION-RUN-TEST"  # Traction Run ID
    assert row[2] == "84047"  # Instrument
    assert row[5] == "TRAC-2-9001"  # Traction ID
    assert row[6] == "DTOL1"  # Sanger Sample ID
    assert row[10] == "A01 use 1"  # cell location
    assert row[11] == "24"  # Run Time (hr)
    assert row[16] == "300"  # Target Loading Concentration
    assert row[17] == "bc2044, bc2052"  # Complex Batch ID (barcodes)
    assert row[30] == "250"  # Loading Conc.
    assert row[35] == "Yes"  # CCS kinetics
    assert row[50] == "Loaded"  # Status
    assert row[51] == "High"  # Prioity


def test_export_window_excludes_out_of_range_runs(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nOUT1,bc9001"})
    past = _past_weekday()
    client.post(
        "/api/cell-uses",
        json={
            "sample_id": _sid(client, "OUT1"),
            "instrument_serial": "84098",
            "run_date": past,
            "slot_index": 0,
            "cell_choice": {"mode": "new"},
            "run_time_hours": 24,
        },
    )
    # A window entirely after the run should return only the header.
    future = (date.today() + timedelta(days=30)).isoformat()
    far = (date.today() + timedelta(days=37)).isoformat()
    rows = _rows(client.get("/api/schedule/export.csv", params={"date_from": future, "date_to": far}).text)
    assert len(rows) == 1
