"""Bridges DB state to the pure engine. Loads the backlog and the reusable prior-cell
pool in the exact form the packing engine expects, so placement/auto-fill re-derive
everything from live DB state rather than trusting any client-supplied plan."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.engine.types import ParsedSample, PriorCellInput
from app.models.cell import Cell
from app.models.sample import Sample
from app.models.schedule import CellUse, Cycle, RunBatch
from app.services.cell_service import current_location, derive_cell_state


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
    stmt = (
        select(Cell)
        .where(Cell.status == "open")
        .options(
            selectinload(Cell.cell_uses)
            .selectinload(CellUse.cycle)
            .selectinload(Cycle.run_batch)
            .selectinload(RunBatch.instrument)
        )
    )
    cells = [c for c in db.scalars(stmt).unique().all() if c.id not in excluded_cell_ids]
    prior_inputs: list[PriorCellInput] = []
    by_id: dict[int, Cell] = {}
    for cell in cells:
        uses_consumed, remaining, burned = derive_cell_state(cell)
        if remaining <= 0:
            continue
        pinned_serial, _well = current_location(cell)
        prior_inputs.append(
            PriorCellInput(
                barcodes_text=" ".join(burned),
                uses_consumed=uses_consumed,
                cell_id=cell.id,
                first_use_started_at=cell.first_use_started_at,
                pinned_instrument_serial=pinned_serial,
            )
        )
        by_id[cell.id] = cell
    return prior_inputs, by_id
