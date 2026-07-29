"""Per-instrument at-a-glance stats for the Instruments management tab.

Follows stats_service.py's doctrine: aggregate in Python (portable across SQLite dev /
Postgres prod - no date_trunc etc.), the dataset is lab-sized so load rows and roll up in
memory, and reuse domain truth (instrument_lock's acquiring_runs + cell_timing's per-cell
model) rather than re-deriving the "currently running" window here."""
from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.cell import Cell
from app.models.cell_tray import CellTray
from app.models.instrument import Instrument
from app.models.schedule import RunBatch
from app.schemas.instrument import InstrumentStatsOut
from app.services.cell_timing import instrument_activity, run_acquisition_end, run_load_at
from app.services.instrument_lock import acquiring_runs
from app.timeutil import utcnow


def instrument_stats(db: Session) -> list[InstrumentStatsOut]:
    now = utcnow()
    today = now.date()
    instruments = db.scalars(select(Instrument).order_by(Instrument.serial_number)).all()

    # --- cells / open trays: a cell belongs to an instrument via its physical tray
    #     (CellTray.instrument_id). One join, rolled up in memory. Open trays are counted
    #     distinct (a tray of 4 open cells is one tray), mirroring the frontend's
    #     groupOpenTrayIdsByInstrument in utils/openTrays.ts. ---
    open_trays_by_instr: dict[int, set[int]] = defaultdict(set)
    cell_total_by_instr: dict[int, int] = defaultdict(int)
    cell_open_by_instr: dict[int, int] = defaultdict(int)
    for instrument_id, tray_id, status in db.execute(
        select(CellTray.instrument_id, Cell.tray_id, Cell.status).join(Cell, Cell.tray_id == CellTray.id)
    ).all():
        cell_total_by_instr[instrument_id] += 1
        if status == "open":
            cell_open_by_instr[instrument_id] += 1
            open_trays_by_instr[instrument_id].add(tray_id)

    # --- runs: load dates for last/next/total, cycles eager-loaded so "still has a
    #     non-terminal plate" can be read in memory for next_run_date. ---
    runs_by_instr: dict[int, list[RunBatch]] = defaultdict(list)
    for r in db.scalars(select(RunBatch).options(selectinload(RunBatch.cycles))).all():
        runs_by_instr[r.instrument_id].append(r)

    out: list[InstrumentStatsOut] = []
    for inst in instruments:
        inst_runs = runs_by_instr.get(inst.id, [])
        load_dates = [r.load_date for r in inst_runs]
        last_run_date = max(load_dates) if load_dates else None
        future = [
            r.load_date
            for r in inst_runs
            if r.load_date > today and any(c.status not in ("completed", "aborted") for c in r.cycles)
        ]
        next_run_date = min(future) if future else None

        # Runs physically ACQUIRING now - "now" falls within each run's [load, last-PPA-end]
        # window from the per-cell timing model (acquiring_runs), NOT the short loading-lock. A
        # single-tray run sequences ~30h but its loading-lock cleared after 6h, so the old
        # loading-lock test made a mid-sequencing run read as "idle" with a blank gantt. Deriving
        # the "currently running" label, the free-at time, and the live per-cell activity from
        # this one set keeps the card self-consistent (no "idle" headline over a "1 sequencing"
        # line, and the gantt below shows exactly these runs).
        active_now = acquiring_runs(db, inst.id, now)
        running_run_name = None
        running_run_id = None
        free_at = None
        if active_now:
            latest = max(active_now, key=lambda r: run_load_at(r) or now)
            running_run_name = latest.run_name or f"#{latest.id}"
            running_run_id = latest.id
            free_at = run_acquisition_end(latest)

        # Live per-cell state now (prep-pending / prepping / sequencing / PPA), across those runs.
        activity = instrument_activity(active_now, now)

        out.append(
            InstrumentStatsOut(
                id=inst.id,
                serial_number=inst.serial_number,
                running_run_name=running_run_name,
                running_run_id=running_run_id,
                free_at=free_at,
                open_tray_count=len(open_trays_by_instr.get(inst.id, ())),
                cell_open_count=cell_open_by_instr.get(inst.id, 0),
                cell_total_count=cell_total_by_instr.get(inst.id, 0),
                last_run_date=last_run_date,
                total_runs=len(inst_runs),
                next_run_date=next_run_date,
                cells_awaiting_prep=activity.awaiting_prep,
                cells_prepping=activity.prepping,
                cells_sequencing=activity.sequencing,
                cells_in_ppa=activity.in_ppa,
                prep_locked=activity.prep_locked,
            )
        )
    return out
