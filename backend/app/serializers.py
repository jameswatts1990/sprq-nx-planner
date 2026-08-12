from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.sample import Sample
from app.schemas.sample import SampleCellUseOut, SampleDetailOut, SampleOut


def duplicate_groups(db: Session, pool_ids: set[str]) -> dict[str, list[int]]:
    """Map each given Pool ID to the ids of every sample carrying it, oldest-first — across
    ALL statuses (incl. completed/cancelled). Lets a serializer stamp the "1/3" ordinal: a
    sample's total = len(group), its index = group.index(sample.id) + 1. One query for a whole
    page/grid; empty input returns {}."""
    if not pool_ids:
        return {}
    groups: dict[str, list[int]] = {}
    for ext, sid in db.execute(
        select(Sample.pool_id, Sample.id)
        .where(Sample.pool_id.in_(pool_ids))
        .order_by(Sample.pool_id, Sample.created_at, Sample.id)
    ).all():
        groups.setdefault(ext, []).append(sid)
    return groups


def duplicate_marker(sample: Sample, groups: dict[str, list[int]]) -> tuple[int | None, int | None]:
    """(index, total) for a sample given a duplicate_groups() map, or (None, None) when it's a
    one-off (or not in the map). Only groups of >1 yield a marker."""
    group = groups.get(sample.pool_id)
    if not group or len(group) <= 1:
        return None, None
    return group.index(sample.id) + 1, len(group)


def sample_out(
    sample: Sample,
    *,
    duplicate_index: int | None = None,
    duplicate_total: int | None = None,
) -> SampleOut:
    return SampleOut(
        id=sample.id,
        pool_id=sample.pool_id,
        plate_id=sample.plate_id,
        sanger_ids=sample.sanger_ids or [],
        target_oplc=sample.target_oplc,
        actual_oplc=sample.actual_oplc,
        cleaned_complex_volume=sample.cleaned_complex_volume,
        loading_buffer_volume=sample.loading_buffer_volume,
        adaptive_loading=sample.adaptive_loading,
        full_resolution_base_q=sample.full_resolution_base_q,
        priority=sample.priority,
        base_kinetics=sample.base_kinetics,
        movie_time_hours=sample.movie_time_hours,
        insert_size_bp=sample.insert_size_bp,
        status=sample.status,
        qc_disposition=sample.qc_disposition,
        barcodes=sample.barcode_list,
        import_batch_id=sample.import_batch_id,
        created_at=sample.created_at,
        updated_at=sample.updated_at,
        duplicate_index=duplicate_index,
        duplicate_total=duplicate_total,
    )


def sample_detail_out(sample: Sample, db: Session | None = None) -> SampleDetailOut:
    dup_index, dup_total = (None, None)
    if db is not None:
        dup_index, dup_total = duplicate_marker(sample, duplicate_groups(db, {sample.pool_id}))
    base = sample_out(sample, duplicate_index=dup_index, duplicate_total=dup_total)
    cell_uses: list[SampleCellUseOut] = []
    for cu in sorted(sample.cell_uses, key=lambda x: x.id):
        run_batch = cu.cycle.run_batch if cu.cycle else None
        cell_uses.append(
            SampleCellUseOut(
                id=cu.id,
                cycle_id=cu.cycle_id,
                run_name=run_batch.run_name if run_batch else None,
                run_batch_id=run_batch.id if run_batch else -1,
                plate_number=cu.cycle.plate_index if cu.cycle else None,
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
