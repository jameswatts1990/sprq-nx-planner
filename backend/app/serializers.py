from __future__ import annotations

from app.models.sample import Sample
from app.schemas.sample import SampleCellUseOut, SampleDetailOut, SampleOut


def sample_out(sample: Sample) -> SampleOut:
    return SampleOut(
        id=sample.id,
        external_id=sample.external_id,
        container_id=sample.container_id,
        parent_sample=sample.parent_sample,
        sanger_ids=sample.sanger_ids or [],
        oplc=sample.oplc,
        target_oplc=sample.target_oplc,
        volume=sample.volume,
        adaptive_loading=sample.adaptive_loading,
        full_resolution_base_q=sample.full_resolution_base_q,
        priority=sample.priority,
        ccs_kinetics=sample.ccs_kinetics,
        status=sample.status,
        barcodes=sample.barcode_list,
        import_batch_id=sample.import_batch_id,
        created_at=sample.created_at,
        updated_at=sample.updated_at,
    )


def sample_detail_out(sample: Sample) -> SampleDetailOut:
    base = sample_out(sample)
    cell_uses: list[SampleCellUseOut] = []
    for cu in sorted(sample.cell_uses, key=lambda x: x.id):
        run_batch = cu.cycle.run_batch if cu.cycle else None
        cell_uses.append(
            SampleCellUseOut(
                id=cu.id,
                cycle_id=cu.cycle_id,
                run_name=cu.cycle.run_name if cu.cycle else None,
                run_batch_id=run_batch.id if run_batch else -1,
                cell_id=cu.cell_id,
                cell_code=cu.cell.code if cu.cell else "",
                well=cu.well,
                status=cu.status,
                started_at=cu.started_at,
                completed_at=cu.completed_at,
                outcome_notes=cu.outcome_notes,
            )
        )
    return SampleDetailOut(**base.model_dump(), cell_uses=cell_uses)
