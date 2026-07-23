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
                "Sample,Sanger Sample IDs,Barcodes,Target OPLC,Priority,"
                "CCS Output Include Kinetics Information\n"
                'TRAC-2-9001,DTOL1,"bc2044 bc2052",300,High,Yes'
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
    assert row[30] == ""  # Loading Conc. — no longer stored (only Target OPLC is kept)
    assert row[35] == "True"  # CCS kinetics — "Yes" normalized to canonical True/False
    assert row[50] == "Loaded"  # Status
    assert row[51] == "High"  # Prioity


def _place_running(client, external_id: str, run_name: str, past: str) -> None:
    placed = client.post(
        "/api/cell-uses",
        json={
            "sample_id": _sid(client, external_id),
            "instrument_serial": "84047",
            "run_date": past,
            "slot_index": 0,
            "cell_choice": {"mode": "new"},
            "run_time_hours": 24,
        },
    )
    assert placed.status_code == 201, placed.text
    client.patch(f"/api/cycles/{placed.json()['cycle_id']}", json={"status": "running", "run_name": run_name})


def test_export_splits_a_clean_multibarcode_pool_one_row_per_barcode(client):
    # 4 barcodes with 4 matching Sanger IDs -> 4 rows, each 25% of the SMRT cell.
    client.post(
        "/api/imports",
        json={
            "raw_text": (
                "Sample,Sanger Sample IDs,Barcodes\n"
                'POOL4,"[""S1"",""S2"",""S3"",""S4""]","bc01 bc02 bc03 bc04"'
            )
        },
    )
    past = _past_weekday()
    _place_running(client, "POOL4", "RUN-POOL4", past)

    rows = _rows(client.get("/api/schedule/export.csv", params={"date_from": past, "date_to": past}).text)
    data = rows[1:]
    assert len(data) == 4  # one row per barcode

    for i, row in enumerate(data, start=1):
        assert row[5] == "POOL4"  # Traction ID (unchanged on every split row)
        assert row[6] == f"S{i}"  # Sanger Sample ID — paired by position
        assert row[7] == "POOL4"  # Pool ID = pool's Traction ID
        assert row[8] == "25%"  # Portion of SMRT Cell
        assert row[17] == f"bc0{i}"  # Complex Batch ID — one barcode per row
        assert row[15] == ""  # no "not split" note


def test_export_keeps_a_mismatched_pool_collapsed_and_flags_it(client):
    # 3 barcodes but only 1 Sanger ID -> can't pair cleanly, so one collapsed row + a flag.
    client.post(
        "/api/imports",
        json={"raw_text": "Sample,Sanger Sample IDs,Barcodes\nPOOLX,S1,\"bc01 bc02 bc03\""},
    )
    past = _past_weekday()
    _place_running(client, "POOLX", "RUN-POOLX", past)

    rows = _rows(client.get("/api/schedule/export.csv", params={"date_from": past, "date_to": past}).text)
    data = rows[1:]
    assert len(data) == 1  # not split
    row = data[0]
    assert row[17] == "bc01, bc02, bc03"  # barcodes stay joined
    assert row[7] == ""  # Pool ID left blank
    assert row[8] == ""  # Portion left blank
    assert row[15] == "Not split: 3 barcodes / 1 Sanger IDs"  # Sequencing Comments flag


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
