"""Bridges DB state to the pure engine and back. Shared by preview_service and
commit_service so both run the exact same query + algorithm path - commit never
trusts a client-supplied plan, it re-derives everything from these same functions."""
from __future__ import annotations

import hashlib
import json

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.engine.kpis import compute_kpis
from app.engine.packing import pack_cells
from app.engine.scheduling import schedule_cells
from app.engine.types import KPIResult, PackResult, ParsedSample, PriorCellInput, ScheduleResult
from app.models.cell import Cell
from app.models.sample import Sample
from app.schemas.schedule import RunDesignSettings
from app.services.cell_service import derive_cell_state


def load_backlog_samples(db: Session, sample_ids: list[int] | None = None) -> list[Sample]:
    stmt = select(Sample).where(Sample.status == "backlog").options(selectinload(Sample.barcodes))
    if sample_ids is not None:
        stmt = stmt.where(Sample.id.in_(sample_ids))
    return list(db.scalars(stmt).unique().all())


def to_parsed_samples(samples: list[Sample]) -> list[ParsedSample]:
    return [
        ParsedSample(
            id=s.external_id,
            barcodes=s.barcode_list,
            parent=s.parent_sample or "",
            sanger=s.sanger_ids or [],
            oplc=s.oplc,
            volume=s.volume,
            key=f"sample:{s.id}",
            sample_id=s.id,
        )
        for s in samples
    ]


def load_prior_cells(db: Session, excluded_cell_ids: list[int]) -> tuple[list[PriorCellInput], dict[int, Cell]]:
    stmt = select(Cell).where(Cell.status == "open").options(selectinload(Cell.cell_uses))
    cells = [c for c in db.scalars(stmt).unique().all() if c.id not in excluded_cell_ids]
    prior_inputs: list[PriorCellInput] = []
    by_id: dict[int, Cell] = {}
    for cell in cells:
        uses_consumed, remaining, burned = derive_cell_state(cell)
        if remaining <= 0:
            continue
        prior_inputs.append(
            PriorCellInput(barcodes_text=" ".join(burned), uses_consumed=uses_consumed, cell_id=cell.id)
        )
        by_id[cell.id] = cell
    return prior_inputs, by_id


def compute_backlog_hash(samples: list[Sample], prior_cells: list[PriorCellInput]) -> str:
    payload = {
        "samples": sorted(
            ({"id": s.id, "status": s.status, "barcodes": sorted(s.barcode_list)} for s in samples),
            key=lambda x: x["id"],
        ),
        "cells": sorted(
            (
                {"id": p.cell_id, "uses_consumed": p.uses_consumed, "barcodes_text": p.barcodes_text}
                for p in prior_cells
            ),
            key=lambda x: x["id"] or 0,
        ),
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


def run_engine(
    samples: list[ParsedSample], prior_cells: list[PriorCellInput], settings: RunDesignSettings
) -> tuple[PackResult, ScheduleResult, KPIResult]:
    pack = pack_cells(samples, max_uses=settings.max_uses, objective=settings.objective, prior_cells=prior_cells)
    sched = schedule_cells(pack.cells, machines=settings.instrument_ids, run_time=settings.run_time_hours)
    kpi = compute_kpis(pack.cells, sched, settings.instrument_ids)
    return pack, sched, kpi
