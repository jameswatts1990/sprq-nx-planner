"""Authoritative commit: re-runs the engine server-side against a freshly-loaded
backlog/cell pool (never trusts a client-supplied plan), 409s if that pool has
drifted from what was previewed, then persists the result transactionally."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.engine.constants import DAY_START_HOUR
from app.models.audit import AuditLog
from app.models.cell import Cell
from app.models.instrument import Instrument
from app.models.sample import Sample
from app.models.schedule import CellUse, CellUseBarcode, Cycle, RunBatch, Schedule
from app.schemas.schedule import CommitRequest
from app.services.cell_service import recompute_status
from app.services.engine_bridge import (
    compute_backlog_hash,
    load_backlog_samples,
    load_prior_cells,
    run_engine,
    to_parsed_samples,
)
from app.timeutil import utcnow


class BacklogChangedError(Exception):
    """Raised when the backlog/cell pool changed since the previewed hash was generated."""


class UnknownInstrumentError(Exception):
    pass


def _day_start(start_date: date) -> datetime:
    return datetime.combine(start_date, time.min, tzinfo=timezone.utc) + timedelta(hours=DAY_START_HOUR)


def commit_schedule(db: Session, req: CommitRequest) -> Schedule:
    samples = load_backlog_samples(db, req.sample_ids)
    parsed = to_parsed_samples(samples)
    prior_cells, cells_by_id = load_prior_cells(db, req.excluded_cell_ids)

    backlog_hash = compute_backlog_hash(samples, prior_cells)
    if backlog_hash != req.expected_backlog_hash:
        raise BacklogChangedError("Backlog or cell pool changed since preview was generated - re-preview and retry.")

    pack, sched, kpi = run_engine(parsed, prior_cells, req.settings)

    schedule = Schedule(
        created_by=req.actor or "unknown",
        status="active",
        settings_json={"run_design": req.settings.model_dump(mode="json"), "kpi": asdict(kpi)},
        start_date=req.settings.start_date,
    )
    db.add(schedule)
    db.flush()

    base = _day_start(req.settings.start_date)

    # resolve/create a DB Cell row for every pack-time cell ref ("C1"/"P1" -> Cell row)
    ref_to_cell: dict[str, Cell] = {}
    for cell in pack.cells:
        if cell.prior:
            ref_to_cell[cell.id] = cells_by_id[cell.cell_id]
        else:
            db_cell = Cell(code="PENDING", max_uses=req.settings.max_uses, status="open")
            db.add(db_cell)
            db.flush()
            db_cell.code = f"CELL-{db_cell.id:06d}"
            ref_to_cell[cell.id] = db_cell

    instruments_by_serial = {i.serial_number: i for i in db.scalars(select(Instrument)).all()}

    groups: dict[tuple[int, int], list] = defaultdict(list)
    for cy in sched.cycles:
        groups[(cy.machine_idx, cy.batch_idx)].append(cy)

    scheduled_sample_ids: set[int] = set()

    for (machine_idx, batch_idx), cycles in groups.items():
        serial = req.settings.instrument_ids[machine_idx]
        instrument = instruments_by_serial.get(serial)
        if instrument is None:
            raise UnknownInstrumentError(f"Unknown instrument serial '{serial}' - check /api/instruments.")

        run_batch = RunBatch(schedule_id=schedule.id, instrument_id=instrument.id, batch_index=batch_idx)
        db.add(run_batch)
        db.flush()

        for cy in sorted(cycles, key=lambda c: c.use_idx):
            cycle = Cycle(
                run_batch_id=run_batch.id,
                use_index=cy.use_idx,
                movie_hours=req.settings.run_time_hours,
                planned_start_at=base + timedelta(hours=cy.start_h),
                planned_end_at=base + timedelta(hours=cy.end_h),
                status="planned",
            )
            db.add(cycle)
            db.flush()

            for st in cy.stages:
                db_cell = ref_to_cell[st.cell.id]
                cell_use = CellUse(
                    cycle_id=cycle.id,
                    cell_id=db_cell.id,
                    sample_id=st.sample.sample_id,
                    use_index=cy.use_idx,
                    well=st.well,
                    status="planned",
                )
                db.add(cell_use)
                db.flush()
                for bc in st.sample.barcodes:
                    db.add(CellUseBarcode(cell_use_id=cell_use.id, barcode=bc))
                if st.sample.sample_id is not None:
                    scheduled_sample_ids.add(st.sample.sample_id)

    if scheduled_sample_ids:
        db.execute(update(Sample).where(Sample.id.in_(scheduled_sample_ids)).values(status="scheduled"))

    # a reused prior cell's capacity just changed (new planned uses were added to it) -
    # keep its persisted status in sync rather than letting it go stale until something
    # else happens to trigger a recompute. cells_by_id's cell_uses collection was
    # eager-loaded by load_prior_cells() BEFORE this transaction's new CellUse rows were
    # flushed, so it must be refreshed here or derive_cell_state() would see stale data.
    now = utcnow()
    for cell in pack.cells:
        if cell.prior:
            db_cell = ref_to_cell[cell.id]
            db.refresh(db_cell, attribute_names=["cell_uses"])
            recompute_status(db_cell, now)

    db.add(
        AuditLog(
            actor=req.actor or "unknown",
            action="commit_schedule",
            entity_type="schedule",
            entity_id=schedule.id,
            details_json={"sample_count": len(scheduled_sample_ids), "cell_count": len(pack.cells)},
        )
    )

    db.commit()
    db.refresh(schedule)
    return schedule


def cancel_schedule(db: Session, schedule: Schedule, actor: str | None) -> Schedule:
    has_started = any(
        cycle.actual_start_at is not None for run_batch in schedule.run_batches for cycle in run_batch.cycles
    )
    if has_started:
        raise ValueError("Cannot cancel a schedule that has already started running.")

    sample_ids = {
        cu.sample_id
        for run_batch in schedule.run_batches
        for cycle in run_batch.cycles
        for cu in cycle.cell_uses
        if cu.sample_id is not None
    }
    if sample_ids:
        db.execute(update(Sample).where(Sample.id.in_(sample_ids)).values(status="backlog"))

    schedule.status = "cancelled"
    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="cancel_schedule",
            entity_type="schedule",
            entity_id=schedule.id,
            details_json={"reverted_sample_count": len(sample_ids)},
        )
    )
    db.commit()
    db.refresh(schedule)
    return schedule
