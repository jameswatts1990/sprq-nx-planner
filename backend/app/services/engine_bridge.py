"""Bridges DB state to the pure engine. Loads the backlog and the reusable prior-cell
pool in the exact form the packing engine expects, so placement/auto-fill re-derive
everything from live DB state rather than trusting any client-supplied plan."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.engine.types import ParsedSample, PriorCellInput
from app.models.cell import Cell
from app.models.cell_tray import CellTray
from app.models.sample import Sample
from app.models.schedule import CellUse, Cycle, RunBatch
from app.services.cell_service import barcode_owners, current_location, derive_cell_state


def load_backlog_samples(db: Session, sample_ids: list[int] | None = None) -> list[Sample]:
    stmt = select(Sample).where(Sample.status == "backlog").options(selectinload(Sample.barcodes))
    if sample_ids is not None:
        stmt = stmt.where(Sample.id.in_(sample_ids))
    return list(db.scalars(stmt).unique().all())


def to_parsed_samples(samples: list[Sample]) -> list[ParsedSample]:
    return [
        ParsedSample(
            id=s.pool_id,
            barcodes=s.barcode_list,
            parent=s.plate_id or "",
            sanger=s.sanger_ids or [],
            priority=s.priority or "",
            # Carried so Auto Schedule can honour the per-sample movie time - both as the run
            # duration it schedules and for the 12h->cell 1 / 30h->cell 4 placement rule (see
            # engine/packing.cell_allowed_positions, engine/slot_scheduling, auto_fill_service).
            movie_time=s.movie_time_hours,
            insert_size_bp=s.insert_size_bp,
            key=f"sample:{s.id}",
            sample_id=s.id,
            created_at=s.created_at,
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
            .selectinload(RunBatch.instrument),
            # Needed for barcode_owners() below, which reads each use's Sample.pool_id to
            # tell a genuine cross-sample barcode clash apart from another copy of the exact
            # same Pool ID (see docs/pacbio-sprq-nx-scheduling-reference.md).
            selectinload(Cell.cell_uses).selectinload(CellUse.sample),
            # A zero-use tray sibling has no CellUse history to derive a location from -
            # current_location() falls back to its tray's instrument, so that relationship
            # needs to be loaded too (see cell_service.current_location()).
            selectinload(Cell.tray).selectinload(CellTray.instrument),
        )
    )
    cells = [c for c in db.scalars(stmt).unique().all() if c.id not in excluded_cell_ids]
    prior_inputs: list[PriorCellInput] = []
    by_id: dict[int, Cell] = {}
    for cell in cells:
        # Tray flagged "skip reuse / planning disposal" - the lab intends to bin the whole
        # tray, so none of its cells should be offered for a further use (see
        # CellTray.reuse_disabled_at). Reversible: clearing the flag re-admits the tray.
        if cell.tray is not None and cell.tray.reuse_disabled_at is not None:
            continue
        uses_consumed, remaining, burned = derive_cell_state(cell)
        if remaining <= 0:
            continue
        pinned_serial, pinned_well = current_location(cell)
        owners = barcode_owners(cell)
        prior_inputs.append(
            PriorCellInput(
                barcodes_text=" ".join(burned),
                barcode_owners={b: frozenset(exts) for b, exts in owners.items()},
                uses_consumed=uses_consumed,
                cell_id=cell.id,
                first_use_started_at=cell.first_use_started_at,
                pinned_instrument_serial=pinned_serial,
                pinned_well=pinned_well,
                tray_id=cell.tray_id,
            )
        )
        by_id[cell.id] = cell
    return prior_inputs, by_id
