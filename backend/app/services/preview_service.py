from __future__ import annotations

from sqlalchemy.orm import Session

from app.engine.types import KPIResult, PackedCell
from app.schemas.schedule import (
    ConflictPairOut,
    CycleOut,
    KPIOut,
    NotesOut,
    PackedCellOut,
    PackedCellUseOut,
    PreviewRequest,
    PreviewResponse,
    StageOut,
    WindowFlagOut,
)
from app.services.engine_bridge import (
    compute_backlog_hash,
    load_backlog_samples,
    load_prior_cells,
    run_engine,
    to_parsed_samples,
)


def kpi_out(kpi: KPIResult) -> KPIOut:
    return KPIOut(
        total_acq=kpi.total_acq,
        fresh_cells=kpi.fresh_cells,
        prior_cells=kpi.prior_cells,
        trays=kpi.trays,
        nx_cost=kpi.nx_cost,
        single_cost=kpi.single_cost,
        savings=kpi.savings,
        savings_pct=kpi.savings_pct,
        duration_days=kpi.duration_days,
        machines=kpi.machines,
    )


def packed_cell_out(cell: PackedCell) -> PackedCellOut:
    return PackedCellOut(
        cell_ref=cell.id,
        cell_id=cell.cell_id,
        is_prior=cell.prior,
        burned_barcodes=sorted(cell.prior_barcodes),
        future_uses=cell.future_uses,
        total_uses=cell.total_uses,
        cost_tier=cell.cost_tier,
        window_hours=cell.window_h,
        instrument_serial=cell.machine,
        stage_no=cell.stage_no,
        uses=[
            PackedCellUseOut(sample_id=s.sample_id, sample_external_id=s.id, barcodes=s.barcodes) for s in cell.uses
        ],
    )


def build_preview(db: Session, req: PreviewRequest) -> PreviewResponse:
    samples = load_backlog_samples(db, req.sample_ids)
    parsed = to_parsed_samples(samples)
    prior_cells, _cells_by_id = load_prior_cells(db, req.excluded_cell_ids)

    pack, sched, kpi = run_engine(parsed, prior_cells, req.settings)

    cycles_out: list[CycleOut] = []
    for cy in sched.cycles:
        stages_out = [
            StageOut(
                cell_ref=st.cell.id,
                cell_id=st.cell.cell_id,
                cell_is_prior=st.cell.prior,
                sample_id=st.sample.sample_id,
                sample_external_id=st.sample.id,
                barcodes=st.sample.barcodes,
                well=st.well,
                stage_no=st.stage_no,
            )
            for st in cy.stages
        ]
        cycles_out.append(
            CycleOut(
                machine_idx=cy.machine_idx,
                instrument_serial=cy.machine,
                batch_idx=cy.batch_idx,
                use_idx=cy.use_idx,
                day_idx=cy.day_idx,
                time_of_day_hours=cy.time_of_day,
                end_day_idx=cy.end_day_idx,
                stages=stages_out,
            )
        )

    notes = NotesOut(
        conflict_pairs=[ConflictPairOut(a=p.a, b=p.b, shared=p.shared) for p in pack.conflict_pairs],
        unplaced_sample_ids=[s.sample_id for s in pack.unplaced if s.sample_id is not None],
        window_flags=[WindowFlagOut(cell_ref=w.cell, span_hours=w.span) for w in sched.window_flags],
    )

    backlog_hash = compute_backlog_hash(samples, prior_cells)

    return PreviewResponse(
        kpi=kpi_out(kpi),
        notes=notes,
        cells=[packed_cell_out(c) for c in pack.cells],
        cycles=cycles_out,
        backlog_hash=backlog_hash,
    )
