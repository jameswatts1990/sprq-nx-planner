"""Assembles the printable batch sheet: for a given load_date (and optional subset of
instruments), one section per run listing everything needed to load it in one session -
both plates, with their acquisition dates, and for each well which cell/sample goes where
and what settings to dial in. Because it is keyed on the run's load day (not each plate's
acquisition day), a reuse run's Plate 2 - loaded now but sequenced the next weekday - prints
on the same sheet as Plate 1 instead of being stranded on a separate day's sheet."""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.engine.constants import CELL_LIFETIME_H
from app.models.instrument import Instrument
from app.models.schedule import CellUse, Cycle, RunBatch
from app.schemas.batch_sheet import BatchSheetOut, BatchSheetPlateOut, BatchSheetRunOut, BatchSheetWellOut
from app.services.run_serializer import _slot_index, _use_number
from app.timeutil import ensure_aware

_OPTIONS = [
    selectinload(RunBatch.instrument),
    selectinload(RunBatch.cycles).selectinload(Cycle.cell_uses).selectinload(CellUse.cell),
    selectinload(RunBatch.cycles).selectinload(Cycle.cell_uses).selectinload(CellUse.sample),
    selectinload(RunBatch.cycles).selectinload(Cycle.cell_uses).selectinload(CellUse.barcodes),
]


def get_batch_sheet(db: Session, load_date: date, instrument_serials: list[str] | None = None) -> BatchSheetOut:
    stmt = select(RunBatch).where(RunBatch.load_date == load_date).options(*_OPTIONS)
    if instrument_serials:
        stmt = stmt.join(RunBatch.instrument).where(Instrument.serial_number.in_(instrument_serials))

    runs = list(db.scalars(stmt).unique().all())
    # Stable, deterministic ordering for the printed sheet regardless of query plan.
    runs.sort(key=lambda rb: (rb.instrument.serial_number if rb.instrument else "?"))

    return BatchSheetOut(load_date=load_date, runs=[_run_out(rb) for rb in runs])


def _run_out(run_batch: RunBatch) -> BatchSheetRunOut:
    instrument = run_batch.instrument
    serial = instrument.serial_number if instrument else "?"
    name = (instrument.name or instrument.serial_number) if instrument else "?"
    plates = [_plate_out(run_batch, c) for c in sorted(run_batch.cycles, key=lambda c: c.plate_index)]
    return BatchSheetRunOut(
        instrument_serial=serial,
        instrument_name=name,
        run_id=run_batch.id,
        run_name=run_batch.run_name,
        load_date=run_batch.load_date,
        # A run reads as running/completed once its plates are; else planned. Kept simple here
        # (the grid's run_serializer has the authoritative derivation) - a plate's status is
        # enough for the sheet's header line.
        status=_run_status(run_batch.cycles),
        plates=plates,
    )


def _run_status(cycles: list[Cycle]) -> str:
    statuses = [c.status for c in cycles]
    if any(s == "running" for s in statuses):
        return "running"
    if statuses and all(s in ("completed", "aborted") for s in statuses):
        return "completed" if any(s == "completed" for s in statuses) else "aborted"
    return "planned"


def _plate_out(run_batch: RunBatch, cycle: Cycle) -> BatchSheetPlateOut:
    wells = [_well_out(cu, cycle.plate_index) for cu in sorted(cycle.cell_uses, key=lambda x: x.well)]
    return BatchSheetPlateOut(
        plate_number=cycle.plate_index,
        acquire_date=cycle.acquire_date,
        is_reuse=cycle.acquire_date > run_batch.load_date,
        movie_hours=cycle.movie_hours,
        wells=wells,
    )


def _well_out(cell_use: CellUse, plate_index: int) -> BatchSheetWellOut:
    cell = cell_use.cell
    sample = cell_use.sample

    deadline = None
    if cell is not None and cell.first_use_started_at is not None:
        deadline = ensure_aware(cell.first_use_started_at) + timedelta(hours=CELL_LIFETIME_H)

    return BatchSheetWellOut(
        well=cell_use.well,
        slot_index=_slot_index(plate_index, cell_use.well),
        plate_number=plate_index,
        cell_ref=cell.code if cell else "?",
        use_number=_use_number(cell_use),
        run_time_hours=cell_use.run_time_hours,
        cell_window_deadline=deadline,
        window_breached=cell.window_breached if cell else False,
        sample_id=cell_use.sample_id,
        sample_external_id=sample.external_id if sample else None,
        parent_sample=sample.parent_sample if sample else None,
        barcodes=cell_use.barcode_list,
        adaptive_loading=sample.adaptive_loading if sample else None,
        base_kinetics=sample.base_kinetics if sample else None,
        full_resolution_base_q=sample.full_resolution_base_q if sample else None,
        target_oplc=sample.target_oplc if sample else None,
        actual_oplc=sample.actual_oplc if sample else None,
        cleaned_complex_volume=sample.cleaned_complex_volume if sample else None,
        loading_buffer_volume=sample.loading_buffer_volume if sample else None,
        notes=cell_use.notes,
    )
