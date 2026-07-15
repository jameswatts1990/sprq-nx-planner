"""Assembles the printable batch sheet: for a given run_date (and optional subset of
instruments), one section per instrument's Cycle listing everything needed to load it -
which cell/well, which sample, and what settings to dial in on the Revio."""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.engine.constants import CELL_LIFETIME_H, WELLS
from app.models.instrument import Instrument
from app.models.schedule import CellUse, Cycle, RunBatch
from app.schemas.batch_sheet import BatchSheetInstrumentOut, BatchSheetOut, BatchSheetWellOut
from app.services.run_serializer import _use_number
from app.timeutil import ensure_aware

_OPTIONS = [
    selectinload(Cycle.run_batch).selectinload(RunBatch.instrument),
    selectinload(Cycle.cell_uses).selectinload(CellUse.cell),
    selectinload(Cycle.cell_uses).selectinload(CellUse.sample),
    selectinload(Cycle.cell_uses).selectinload(CellUse.barcodes),
]


def get_batch_sheet(db: Session, run_date: date, instrument_serials: list[str] | None = None) -> BatchSheetOut:
    stmt = select(Cycle).join(Cycle.run_batch).where(RunBatch.run_date == run_date).options(*_OPTIONS)
    if instrument_serials:
        stmt = stmt.join(RunBatch.instrument).where(Instrument.serial_number.in_(instrument_serials))

    cycles = list(db.scalars(stmt).unique().all())
    # Stable, deterministic ordering for the printed sheet regardless of query plan.
    cycles.sort(key=lambda c: (c.run_batch.instrument.serial_number if c.run_batch and c.run_batch.instrument else "?"))

    instruments = [_instrument_out(cycle) for cycle in cycles]
    return BatchSheetOut(run_date=run_date, instruments=instruments)


def _instrument_out(cycle: Cycle) -> BatchSheetInstrumentOut:
    run_batch = cycle.run_batch
    instrument = run_batch.instrument if run_batch else None
    serial = instrument.serial_number if instrument else "?"
    name = (instrument.name or instrument.serial_number) if instrument else "?"

    wells = [_well_out(cu) for cu in sorted(cycle.cell_uses, key=lambda x: x.well)]

    return BatchSheetInstrumentOut(
        instrument_serial=serial,
        instrument_name=name,
        cycle_id=cycle.id,
        movie_hours=cycle.movie_hours,
        status=cycle.status,
        planned_start_at=cycle.planned_start_at,
        planned_end_at=cycle.planned_end_at,
        wells=wells,
    )


def _well_out(cell_use: CellUse) -> BatchSheetWellOut:
    cell = cell_use.cell
    sample = cell_use.sample

    deadline = None
    if cell is not None and cell.first_use_started_at is not None:
        deadline = ensure_aware(cell.first_use_started_at) + timedelta(hours=CELL_LIFETIME_H)

    return BatchSheetWellOut(
        well=cell_use.well,
        slot_index=WELLS.index(cell_use.well) if cell_use.well in WELLS else 0,
        cell_ref=cell.code if cell else "?",
        use_number=_use_number(cell_use),
        cell_window_deadline=deadline,
        window_breached=cell.window_breached if cell else False,
        sample_id=cell_use.sample_id,
        sample_external_id=sample.external_id if sample else None,
        sample_container_id=sample.container_id if sample else None,
        barcodes=cell_use.barcode_list,
        adaptive_loading=sample.adaptive_loading if sample else None,
        ccs_kinetics=sample.ccs_kinetics if sample else None,
        full_resolution_base_q=sample.full_resolution_base_q if sample else None,
        target_oplc=sample.target_oplc if sample else None,
        oplc=sample.oplc if sample else None,
        volume=sample.volume if sample else None,
    )
