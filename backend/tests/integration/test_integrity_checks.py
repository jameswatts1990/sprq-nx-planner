"""Inline duplicate warnings (Int #3): a run name or PacBio case number already used elsewhere.
Both checks are advisory - they only list the other users; saving is never blocked."""
from datetime import date, timedelta

from app.models.cell import Cell


def _weekday() -> str:
    d = date.today() + timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d.isoformat()


def _run_with_name(client, pool_id: str, name: str) -> int:
    client.post("/api/imports", json={"raw_text": f"sample,barcodes\n{pool_id},bc-{pool_id}"})
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    sample_id = next(s["id"] for s in items if s["pool_id"] == pool_id)
    placed = client.post(
        "/api/cell-uses",
        json={"sample_id": sample_id, "instrument_serial": "84047", "load_date": _weekday(), "slot_index": 0,
              "cell_choice": {"mode": "new"}, "run_time_hours": 24},
    )
    assert placed.status_code == 201, placed.text
    run_id = placed.json()["run_id"]
    locked = client.patch(f"/api/cycles/{run_id}", json={"status": "running", "run_name": name})
    assert locked.status_code == 200, locked.text
    return run_id


def test_run_name_check_matches_trimmed_and_case_insensitive(client):
    run_id = _run_with_name(client, "P1", "TRACTION-RUN-7")

    hits = client.get("/api/cycles/run-name-check", params={"name": "  traction-run-7 "}).json()
    assert [(h["run_id"], h["run_name"], h["instrument_serial"]) for h in hits] == [
        (run_id, "TRACTION-RUN-7", "84047")
    ]
    assert client.get("/api/cycles/run-name-check", params={"name": "TRACTION-RUN-8"}).json() == []
    assert client.get("/api/cycles/run-name-check", params={"name": "  "}).json() == []


def test_run_name_check_leaves_out_the_run_being_named(client):
    run_id = _run_with_name(client, "P1", "TRACTION-RUN-7")
    hits = client.get(
        "/api/cycles/run-name-check", params={"name": "TRACTION-RUN-7", "exclude_run_id": run_id}
    ).json()
    assert hits == []


def test_case_number_check_spans_cells_and_cases_without_a_cell(client, db_session):
    cell = Cell(code="C-TEST-1", pacbio_case_number="CS-000123")
    db_session.add(cell)
    db_session.commit()
    case = client.post(
        "/api/pacbio-cases",
        json={"summary": "Untracked cell failed", "occurred_on": date.today().isoformat(),
              "pacbio_case_number": "cs-000123 "},
    )
    assert case.status_code in (200, 201), case.text
    case_id = case.json()["id"]

    hits = client.get("/api/credit/case-number-check", params={"number": "CS-000123"}).json()
    assert {(h["kind"], h["id"], h["label"]) for h in hits} == {
        ("cell", cell.id, "C-TEST-1"),
        ("case", case_id, "Untracked cell failed"),
    }
    # Typing on the cell's own case leaves the cell out, and likewise for the no-cell case.
    own_cell = client.get(
        "/api/credit/case-number-check", params={"number": "CS-000123", "exclude_cell_id": cell.id}
    ).json()
    assert [h["kind"] for h in own_cell] == ["case"]
    own_case = client.get(
        "/api/credit/case-number-check", params={"number": "CS-000123", "exclude_case_id": case_id}
    ).json()
    assert [h["kind"] for h in own_case] == ["cell"]
    assert client.get("/api/credit/case-number-check", params={"number": "CS-999"}).json() == []
