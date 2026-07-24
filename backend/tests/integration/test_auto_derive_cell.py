"""The engine-derived cell path: placing a sample with `cell_choice` OMITTED lets the backend
derive which physical cell it lands on - reuse-before-new, the same rule auto-fill uses (see
placement_service.derive_best_cell) - instead of the client choosing. Covers intra-run Plate-2
reuse, cross-run reuse, position pinning, the barcode-clash and 108h-window fallbacks to a new
cell, and that an explicit cell_choice still overrides derivation."""
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select

from app.models.instrument import Instrument
from app.schemas.cell import CellBootstrapRequest
from app.services.cell_service import bootstrap_cell
from app.services.placement_service import derive_best_cell


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


def _sid(client, external_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["external_id"] == external_id)


def _stages(run):
    return [s for p in run["plates"] for s in p["stages"]]


def _auto_place(client, sample_id, run_date, slot_index, instrument="84047", run_time_hours=24):
    """Place with NO cell_choice - the backend derives the cell."""
    return client.post(
        "/api/cell-uses",
        json={
            "sample_id": sample_id,
            "instrument_serial": instrument,
            "load_date": run_date,
            "slot_index": slot_index,
            "run_time_hours": run_time_hours,
        },
    )


def _place(client, sample_id, run_date, slot_index, cell_choice, instrument="84047", run_time_hours=24):
    return client.post(
        "/api/cell-uses",
        json={
            "sample_id": sample_id,
            "instrument_serial": instrument,
            "load_date": run_date,
            "slot_index": slot_index,
            "cell_choice": cell_choice,
            "run_time_hours": run_time_hours,
        },
    )


def test_auto_place_into_empty_slot_opens_a_new_cell(client):
    """No reuse candidate anywhere -> the deriver opens a fresh cell (Use 1)."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)
    r = _auto_place(client, _sid(client, "A1"), mon, 0)
    assert r.status_code == 201, r.text
    run = r.json()
    stage = _stages(run)[0]
    assert stage["use_number"] == 1
    assert run["plates"][0]["is_reuse"] is False
    assert stage["well"] == "A01"


def test_auto_place_on_plate2_reuses_plate1_cell_as_use2(client):
    """Dropping onto a Plate-2 slot aligned with a filled Plate-1 cell derives the intra-run
    reuse: the SAME physical cell, its sequential Use 2, acquiring the next weekday - the
    one-tray reuse run, with no cell_choice needed."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    mon, tue = _weekdays(2)
    r1 = _place(client, _sid(client, "A1"), mon, 0, {"mode": "new"})
    cell_x = _stages(r1.json())[0]["cell_id"]

    r2 = _auto_place(client, _sid(client, "A2"), mon, 4)  # Plate-2 A slot, no cell_choice
    assert r2.status_code == 201, r2.text
    run = r2.json()
    plate2 = next(p for p in run["plates"] if p["plate_index"] == 2)
    assert plate2["is_reuse"] is True
    assert plate2["acquire_date"] == tue  # reuse acquires the next weekday
    a2_stage = next(s for s in _stages(run) if s["sample_external_id"] == "A2")
    assert a2_stage["cell_id"] == cell_x  # same physical cell - one tray
    assert a2_stage["use_number"] == 2
    assert a2_stage["well"] == "A01"  # keeps the cell's own well, not the slot's nominal A02


def test_auto_place_cross_run_reuses_idle_cell(client):
    """An idle open cell from an earlier run, pinned to this slot's well and still in-window,
    is derived as a cross-run reuse (Use 2) rather than opening a new tray."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    mon, tue = _weekdays(2)
    r1 = _place(client, _sid(client, "A1"), mon, 0, {"mode": "new"})
    cell_x = _stages(r1.json())[0]["cell_id"]

    r2 = _auto_place(client, _sid(client, "A2"), tue, 0)  # slot 0 on a later day, no cell_choice
    assert r2.status_code == 201, r2.text
    a2_stage = _stages(r2.json())[0]
    assert a2_stage["cell_id"] == cell_x  # reused the idle cell rather than a fresh one
    assert a2_stage["use_number"] == 2


def test_auto_place_reuse_is_position_pinned(client):
    """The reuse target lines up by within-tray position: a drop on the Plate-2 B slot reuses
    Plate 1's B cell, not its A cell."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nB1,bc2\nC1,bc3"})
    (mon,) = _weekdays(1)
    ra = _place(client, _sid(client, "A1"), mon, 0, {"mode": "new"})  # opens the A01-D01 tray
    cell_a = _stages(ra.json())[0]["cell_id"]
    tray_id = client.get(f"/api/cells/{cell_a}").json()["tray_id"]
    b_cell = next(
        c["id"] for c in client.get("/api/cells", params={"tray_id": tray_id}).json()["items"] if c["current_well"] == "B01"
    )
    _place(client, _sid(client, "B1"), mon, 1, {"mode": "existing", "cell_id": b_cell})  # fill Plate 1 B

    r = _auto_place(client, _sid(client, "C1"), mon, 5)  # Plate-2 B slot, no cell_choice
    assert r.status_code == 201, r.text
    c_stage = next(s for s in _stages(r.json()) if s["sample_external_id"] == "C1")
    assert c_stage["cell_id"] == b_cell  # the B cell, not cell_a
    assert c_stage["well"] == "B01"


def test_auto_place_falls_back_to_new_cell_on_barcode_clash(client):
    """A reuse candidate that shares a burned barcode with the sample can't be read twice on
    one cell, so the deriver skips it and opens a fresh cell instead - never a silent clash."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc1"})  # same barcode
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "A1"), mon, 0, {"mode": "new"})
    cell_x = _stages(r1.json())[0]["cell_id"]

    r2 = _auto_place(client, _sid(client, "A2"), mon, 4)  # would reuse cell_x, but bc1 clashes
    assert r2.status_code == 201, r2.text
    a2_stage = next(s for s in _stages(r2.json()) if s["sample_external_id"] == "A2")
    assert a2_stage["cell_id"] != cell_x  # fell back to a fresh cell
    assert a2_stage["use_number"] == 1


def test_explicit_cell_choice_still_overrides_derivation(client):
    """An explicit {"mode":"new"} forces a fresh parallel tray even where an intra-run reuse
    was available - the override path behind the cell stub."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    (mon,) = _weekdays(1)
    r1 = _place(client, _sid(client, "A1"), mon, 0, {"mode": "new"})
    cell_x = _stages(r1.json())[0]["cell_id"]

    r2 = _place(client, _sid(client, "A2"), mon, 4, {"mode": "new"})  # explicit new, not derive
    assert r2.status_code == 201, r2.text
    a2_stage = next(s for s in _stages(r2.json()) if s["sample_external_id"] == "A2")
    assert a2_stage["cell_id"] != cell_x  # forced a new cell despite the reuse being available
    assert a2_stage["use_number"] == 1


def test_override_reuse_to_new_cell_builds_a_fresh_same_day_plate(client):
    """The cell stub's "Use a new cell instead" override (CellInfoPopover) is a remove + fresh
    place, NOT a move - so turning a reuse into a fresh cell rebuilds Plate 2 as a same-day
    parallel tray (a new cell, Use 1, acquiring the load day, is_reuse False), rather than
    leaving the fresh cell stranded on the reuse's next-day acquire. Exercises the exact
    backend sequence the override fires."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1\nA2,bc2"})
    mon, tue = _weekdays(2)
    r1 = _place(client, _sid(client, "A1"), mon, 0, {"mode": "new"})
    cell_x = _stages(r1.json())[0]["cell_id"]

    # Auto-derive a reuse on the aligned Plate-2 slot (Use 2, next-day, is_reuse).
    r2 = _auto_place(client, _sid(client, "A2"), mon, 4)
    reuse_stage = next(s for s in _stages(r2.json()) if s["sample_external_id"] == "A2")
    assert reuse_stage["cell_id"] == cell_x and reuse_stage["use_number"] == 2

    # The override: remove the reuse, then place fresh at the same slot.
    client.delete(f"/api/cell-uses/{reuse_stage['cell_use_id']}")
    r3 = _place(client, _sid(client, "A2"), mon, 4, {"mode": "new"})
    assert r3.status_code == 201, r3.text
    run = r3.json()
    plate2 = next(p for p in run["plates"] if p["plate_index"] == 2)
    a2 = next(s for s in _stages(run) if s["sample_external_id"] == "A2")
    assert a2["cell_id"] != cell_x  # a genuinely fresh cell, not the reused one
    assert a2["use_number"] == 1
    assert plate2["acquire_date"] == mon  # same-day parallel tray, not the reuse's next day
    assert plate2["is_reuse"] is False


def test_derive_best_cell_skips_an_out_of_window_cell(db_session):
    """load_prior_cells offers every open cell with no 108h filter (the window is advisory
    there); derive_best_cell must apply the window itself, so a still-"open" cell whose
    108h window closed long before the target day is NOT auto-reused - it falls to a new
    cell. Bootstraps a cell whose first use is in 2020 (kept "open" by bootstrap) and asks
    the deriver to place onto its well far in the future."""
    instrument = db_session.scalar(select(Instrument).where(Instrument.serial_number == "84047"))
    bootstrap_cell(
        db_session,
        CellBootstrapRequest(
            uses_consumed=1,
            burned_barcodes=["bcold"],
            first_use_started_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
            instrument_serial="84047",
        ),
    )
    # Next Monday - ~6 years after the bootstrapped cell's first use, so its 108h window is
    # long shut even though load_prior_cells still lists it as "open".
    d = date.today() + timedelta(days=1)
    while d.weekday() != 0:
        d += timedelta(days=1)

    choice = derive_best_cell(
        db_session,
        instrument=instrument,
        load_date=d,
        slot_index=0,  # well A01 - exactly where the bootstrapped cell sits
        sample_barcodes=["bcnew"],
        run_time_hours=24,
    )
    assert choice == {"mode": "new"}
