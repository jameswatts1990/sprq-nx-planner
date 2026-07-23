"""Builds the "sequencing tracker" CSV export from the scheduled grid.

One row per scheduled well (CellUse) across the cycles in a date window, in the exact
56-column layout defined in engine/tracker_columns.py so the output can be pasted
straight into the lab's Google Sheet. Only the ~14 fields the app actually stores are
filled; every other column is present-but-blank (per the P1-only scope).

Because only a subset of columns carry values, this export is meant for *appending*
newly-scheduled rows to the sheet — pasting a row over an existing one would blank its
QC/finance columns.
"""
from __future__ import annotations

import csv
import io
import json
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.engine.tracker_columns import (
    K_BARCODES,
    K_CCS_KINETICS,
    K_CELL_LOCATION,
    K_DATE_RUN_STARTED,
    K_INSTRUMENT,
    K_LOADING_CONC,
    K_PLATE_ID,
    K_PRIORITY,
    K_RUN_TIME,
    K_SANGER,
    K_STATUS,
    K_TARGET_OPLC,
    K_TRACTION_ID,
    K_TRACTION_RUN_ID,
    TRACKER_COLUMNS,
    TRACKER_HEADER,
)
from app.models.instrument import Instrument
from app.models.schedule import CellUse, Cycle, RunBatch
from app.services.run_serializer import CYCLE_LOAD_OPTIONS, _use_number


def _fmt_date(d: date | None) -> str:
    return d.strftime("%d/%m/%Y") if d else ""


def _fmt_number(value: float | int | None) -> str:
    if value is None:
        return ""
    # Keep whole numbers whole (300, not 300.0) to match how the sheet stores them.
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _fmt_sanger(sanger_ids: list[str] | None) -> str:
    ids = [s for s in (sanger_ids or []) if s]
    if not ids:
        return ""
    if len(ids) == 1:
        return ids[0]
    # Multiple IDs are stored in the sheet as a JSON array literal (no spaces), e.g.
    # ["DTOL16841063","Meier_Gen16867226"]; csv quoting handles the commas/quotes.
    return json.dumps(ids, separators=(",", ":"))


def sheet_status(sample_status: str | None, cycle_status: str) -> str:
    """Map the app's internal status onto the sheet's Status vocabulary.

    A locked/running run reads as "Loaded"; a placed-but-not-started sample reads as
    "In Progress". Completed/failed runs are left blank because the sheet drives those
    from the (out-of-scope) LangQC "Well Status" column, not this field."""
    if cycle_status == "running":
        return "Loaded"
    if sample_status == "in_progress":
        return "Loaded"
    if sample_status == "scheduled":
        return "In Progress"
    return ""


def _cell_location(cell_use: CellUse) -> str:
    """"A01 use 2" — the well plus this cell's 1-based use number (the Use 1/2/3 the grid shows)."""
    if not cell_use.well:
        return ""
    return f"{cell_use.well} use {_use_number(cell_use)}"


def _row_values(cell_use: CellUse, cycle: Cycle, serial: str) -> dict[str, str]:
    sample = cell_use.sample
    return {
        K_DATE_RUN_STARTED: _fmt_date(cycle.run_batch.run_date if cycle.run_batch else None),
        K_TRACTION_RUN_ID: cycle.run_name or "",
        K_INSTRUMENT: serial,
        K_PLATE_ID: (sample.container_id or "") if sample else "",
        K_TRACTION_ID: (sample.external_id or "") if sample else "",
        K_SANGER: _fmt_sanger(sample.sanger_ids if sample else None),
        K_CELL_LOCATION: _cell_location(cell_use),
        K_RUN_TIME: _fmt_number(cycle.movie_hours),
        K_TARGET_OPLC: _fmt_number(sample.target_oplc) if sample else "",
        # Barcodes live in the "Complex Batch ID" column (see tracker_columns). Prefer the
        # per-use snapshot; fall back to the sample's own barcodes if the snapshot is empty.
        K_BARCODES: ", ".join(cell_use.barcode_list or (sample.barcode_list if sample else [])),
        K_LOADING_CONC: _fmt_number(sample.oplc) if sample else "",
        K_CCS_KINETICS: (sample.ccs_kinetics or "") if sample else "",
        K_STATUS: sheet_status(sample.status if sample else None, cycle.status),
        K_PRIORITY: (sample.priority or "") if sample else "",
    }


def build_schedule_csv(
    db: Session,
    date_from: date | None = None,
    date_to: date | None = None,
    instrument_serial: str | None = None,
) -> str:
    stmt = select(Cycle).join(Cycle.run_batch).options(*CYCLE_LOAD_OPTIONS)
    if instrument_serial:
        stmt = stmt.join(RunBatch.instrument).where(Instrument.serial_number == instrument_serial)
    if date_from:
        stmt = stmt.where(RunBatch.run_date >= date_from)
    if date_to:
        stmt = stmt.where(RunBatch.run_date <= date_to)
    cycles = list(db.scalars(stmt).unique().all())

    # Deterministic order: by run date, then instrument, then well — matching the grid.
    def cycle_key(c: Cycle) -> tuple:
        rb = c.run_batch
        serial = rb.instrument.serial_number if rb and rb.instrument else ""
        return (rb.run_date if rb else date.min, serial, c.id)

    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(TRACKER_HEADER)

    for cycle in sorted(cycles, key=cycle_key):
        serial = cycle.run_batch.instrument.serial_number if cycle.run_batch and cycle.run_batch.instrument else ""
        for cell_use in sorted(cycle.cell_uses, key=lambda cu: cu.well):
            values = _row_values(cell_use, cycle, serial)
            writer.writerow([values.get(key, "") for _, key in TRACKER_COLUMNS])

    return buf.getvalue()
