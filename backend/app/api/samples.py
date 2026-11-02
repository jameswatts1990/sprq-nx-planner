from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import ActorDep, SessionDep, pagination
from app.engine.csv_parse import split_barcodes
from app.engine.packing import pool_id_sort_key, priority_rank
from app.models.audit import AuditLog
from app.models.sample import SAMPLE_STATUSES, Sample, SampleBarcode, sample_id_matches
from app.models.schedule import CellUse, Cycle, RunBatch
from app.schemas.common import Page
from app.schemas.sample import SampleCreate, SampleDetailOut, SampleOut, SampleUpdate
from app.serializers import (
    duplicate_groups,
    duplicate_marker,
    sample_detail_out,
    sample_out,
)
from app.services.sample_service import (
    create_backlog_sample,
    existing_samples_with_id,
    update_backlog_sample,
    update_placed_sample_metadata,
)

router = APIRouter(prefix="/api/samples", tags=["samples"])

SORTABLE_FIELDS = (
    "created_at",
    "updated_at",
    "pool_id",
    "barcode",
    "priority",
    "status",
    "plate_id",
    "sanger_ids",
    "target_oplc",
    "actual_oplc",
    "adaptive_loading",
    "full_resolution_base_q",
    "base_kinetics",
)


def _first_barcode(sample: Sample) -> str:
    return sample.barcode_list[0] if sample.barcode_list else ""


# Columns that sort in SQL, so a page is one LIMITed query however many samples match. Text is
# lower-cased and a blank counts as empty, so - like _sort_none_last - empty cells stay last
# whichever way the sort runs. Ties fall back to newest first.
_SQL_SORT_KEYS = {
    "created_at": Sample.created_at,
    "updated_at": Sample.updated_at,
    "pool_id": func.lower(Sample.pool_id),
    "status": Sample.status,
    "plate_id": func.nullif(func.lower(Sample.plate_id), ""),
    "target_oplc": Sample.target_oplc,
    "actual_oplc": Sample.actual_oplc,
    "adaptive_loading": func.nullif(func.lower(Sample.adaptive_loading), ""),
    "full_resolution_base_q": func.nullif(func.lower(Sample.full_resolution_base_q), ""),
    "base_kinetics": func.nullif(func.lower(Sample.base_kinetics), ""),
}


def _sort_none_last(samples: list[Sample], key, reverse: bool) -> list[Sample]:
    """Stable sort keeping rows with an empty (None) key at the end regardless of
    direction, so flipping asc/desc never floats blank cells to the top."""
    present = sorted((s for s in samples if key(s) is not None), key=key, reverse=reverse)
    absent = [s for s in samples if key(s) is None]
    return present + absent


def _filtered_samples(
    status: str | None, q: str | None, priority: str | None, qc_disposition: str | None
) -> Select[tuple[Sample]]:
    stmt = select(Sample)
    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        for s in statuses:
            if s not in SAMPLE_STATUSES:
                raise HTTPException(400, f"Unknown status '{s}'. Valid: {', '.join(SAMPLE_STATUSES)}")
        stmt = stmt.where(Sample.status.in_(statuses))
    if priority:
        priorities = [p.strip() for p in priority.split(",") if p.strip()]
        stmt = stmt.where(Sample.priority.in_(priorities))
    if qc_disposition:
        tokens = [t.strip() for t in qc_disposition.split(",") if t.strip()]
        values = [t for t in tokens if t != "none"]
        clauses = []
        if "none" in tokens:
            clauses.append(Sample.qc_disposition.is_(None))
        if values:
            clauses.append(Sample.qc_disposition.in_(values))
        if clauses:
            stmt = stmt.where(or_(*clauses))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                sample_id_matches(like),
                Sample.priority.ilike(like),
                Sample.barcodes.any(SampleBarcode.barcode.ilike(like)),
            )
        )
    return stmt


def _sorted_page(
    db: SessionDep, stmt: Select[tuple[Sample]], sort_by: str, sort_dir: str, page: int, page_size: int
) -> tuple[list[Sample], int]:
    """One page of `stmt`'s samples (barcodes loaded) in the requested order, and the total."""
    if sort_by not in SORTABLE_FIELDS:
        raise HTTPException(400, f"Unknown sort_by '{sort_by}'. Valid: {', '.join(SORTABLE_FIELDS)}")
    if sort_dir not in ("asc", "desc"):
        raise HTTPException(400, "sort_dir must be 'asc' or 'desc'")
    start = (page - 1) * page_size
    reverse = sort_dir == "desc"

    if sort_by in _SQL_SORT_KEYS:
        key = _SQL_SORT_KEYS[sort_by]
        order = [(key.desc() if reverse else key.asc()).nulls_last()]
        # created_at ties break by id in the same direction; everything else newest first.
        order.append(Sample.id.desc() if reverse or sort_by != "created_at" else Sample.id.asc())
        total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        items = db.scalars(
            stmt.order_by(*order).limit(page_size).offset(start).options(selectinload(Sample.barcodes))
        ).all()
        return list(items), total

    all_matching = list(
        db.scalars(stmt.order_by(Sample.created_at.desc()).options(selectinload(Sample.barcodes))).unique().all()
    )
    if sort_by == "barcode":
        all_matching.sort(key=lambda s: _first_barcode(s).lower(), reverse=reverse)
    elif sort_by == "priority":
        # Tie-break equal-rank samples by External ID (natural sort), mirroring the
        # scheduler's processing order (engine/packing.pack_samples) so the Backlog's
        # displayed priority order matches the order samples will actually be packed -
        # and so identical priority labels group together instead of scattering by an
        # arbitrary insertion/created_at order.
        all_matching.sort(
            key=lambda s: (priority_rank(s.priority), pool_id_sort_key(s.pool_id)),
            reverse=reverse,
        )
    else:  # sanger_ids
        all_matching = _sort_none_last(
            all_matching, lambda s: s.sanger_ids[0].lower() if s.sanger_ids else None, reverse
        )
    return all_matching[start : start + page_size], len(all_matching)


@router.get("", response_model=Page[SampleOut])
def list_samples(
    db: SessionDep,
    page_info: Annotated[tuple[int, int], Depends(pagination)],
    status: str | None = None,
    q: str | None = None,
    priority: str | None = None,
    qc_disposition: str | None = None,
    sort_by: str = "created_at",
    sort_dir: str = "desc",
) -> Page[SampleOut]:
    """One filterable endpoint covers the backlog (status=backlog) and any other status list.
    `qc_disposition` is a comma-list of tags, plus the sentinel "none" (untagged); the Backlog's
    main list passes "none" to exclude the Recoverable-section rows, the Recoverable section
    passes the tags."""
    page, page_size = page_info
    stmt = _filtered_samples(status, q, priority, qc_disposition)
    page_items, total = _sorted_page(db, stmt, sort_by, sort_dir, page, page_size)
    # Stamp the "1/3" duplicate ordinal for the visible page in one grouped query.
    groups = duplicate_groups(db, {s.pool_id for s in page_items})
    items = []
    for s in page_items:
        dup_index, dup_total = duplicate_marker(s, groups)
        items.append(sample_out(s, duplicate_index=dup_index, duplicate_total=dup_total))
    return Page[SampleOut](items=items, total=total)


@router.get("/history", response_model=Page[SampleDetailOut])
def list_sample_history(
    db: SessionDep,
    page_info: Annotated[tuple[int, int], Depends(pagination)],
    status: str | None = None,
    q: str | None = None,
    priority: str | None = None,
    sort_by: str = "updated_at",
    sort_dir: str = "desc",
) -> Page[SampleDetailOut]:
    """The Samples page: the same filters and sorts as list_samples, each sample carrying its
    cell uses (run, plate, well, cell, status) so the row shows where it ran without a fetch per
    row. Registered above /{sample_id} so this literal path isn't shadowed by that int route."""
    page, page_size = page_info
    stmt = _filtered_samples(status, q, priority, None)
    page_items, total = _sorted_page(db, stmt, sort_by, sort_dir, page, page_size)
    if page_items:
        # Fills cell_uses on the already-loaded page samples (identity map), one query per level.
        db.scalars(
            select(Sample)
            .where(Sample.id.in_([s.id for s in page_items]))
            .options(
                selectinload(Sample.cell_uses)
                .selectinload(CellUse.cycle)
                .selectinload(Cycle.run_batch)
                .selectinload(RunBatch.instrument),
                selectinload(Sample.cell_uses).selectinload(CellUse.cell),
            )
        ).all()
    groups = duplicate_groups(db, {s.pool_id for s in page_items})
    return Page[SampleDetailOut](items=[sample_detail_out(s, groups=groups) for s in page_items], total=total)


@router.post("", response_model=SampleOut, status_code=201)
def create_sample(
    req: SampleCreate, db: SessionDep, actor: ActorDep, allow_duplicate: bool = False
) -> SampleOut:
    """Manually add one sample to the backlog (same landing spot as CSV import).

    Duplicates are allowed (the same sample can be run across multiple cells), but unlike
    CSV import — which only warns after the fact — the manual path *confirms* first: if this
    Pool ID has been seen before (any status, incl. completed) and `allow_duplicate` is
    false, it returns a 409 the UI turns into an "Add another copy anyway?" prompt. Re-submitting
    with `allow_duplicate=true` creates the copy."""
    pool_id = req.pool_id.strip()
    if not pool_id:
        raise HTTPException(422, "Pool ID is required")
    barcodes = split_barcodes(" ".join(req.barcodes))
    if not barcodes:
        raise HTTPException(422, "At least one barcode is required")

    if not allow_duplicate:
        existing = existing_samples_with_id(db, pool_id)
        if existing:
            n = len(existing)
            raise HTTPException(
                409,
                detail={
                    "code": "duplicate_pool",
                    "message": f"Pool ID '{pool_id}' has been seen {n} time{'s' if n != 1 else ''} "
                    f"before (including completed samples). Add another copy anyway?",
                    "seen_count": n,
                    "statuses": [s.status for s in existing],
                },
            )

    sample = create_backlog_sample(
        db,
        pool_id=pool_id,
        barcodes=barcodes,
        sanger_ids=req.sanger_ids,
        plate_id=req.plate_id,
        target_oplc=req.target_oplc,
        actual_oplc=req.actual_oplc,
        cleaned_complex_volume=req.cleaned_complex_volume,
        loading_buffer_volume=req.loading_buffer_volume,
        adaptive_loading=req.adaptive_loading,
        full_resolution_base_q=req.full_resolution_base_q,
        priority=req.priority,
        base_kinetics=req.base_kinetics,
        movie_time_hours=req.movie_time_hours,
        insert_size_bp=req.insert_size_bp,
    )
    db.add(AuditLog(actor=actor, action="create_sample", entity_type="sample", entity_id=sample.id, details_json={}))
    db.commit()
    db.refresh(sample)
    return sample_out(sample)


@router.get("/priorities", response_model=list[str])
def list_priorities(db: SessionDep, status: str | None = None) -> list[str]:
    """Distinct priority values in use, ranked the same way the table sorts them, so a
    filter dropdown built from this lines up with the Backlog's own priority ordering.
    `status` scopes the list to matching samples (the Backlog filter passes status=backlog)
    so the dropdown never offers a priority that only exists on cancelled/completed samples
    and would return zero rows once selected.
    Registered above /{sample_id} so this literal path isn't shadowed by that int route."""
    stmt = select(Sample.priority).distinct().where(Sample.priority.isnot(None))
    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        for s in statuses:
            if s not in SAMPLE_STATUSES:
                raise HTTPException(400, f"Unknown status '{s}'. Valid: {', '.join(SAMPLE_STATUSES)}")
        stmt = stmt.where(Sample.status.in_(statuses))
    values = db.scalars(stmt).all()
    return sorted(values, key=priority_rank)


@router.get("/{sample_id}", response_model=SampleDetailOut)
def get_sample(sample_id: int, db: SessionDep) -> SampleDetailOut:
    sample = db.get(
        Sample,
        sample_id,
        options=[
            selectinload(Sample.barcodes),
            selectinload(Sample.cell_uses),
        ],
    )
    if sample is None:
        raise HTTPException(404, "Sample not found")
    return sample_detail_out(sample, db)


# A sample that has finished its lifecycle - its schedule is history, not a plan, so it's
# read-only. Everything before that (backlog, or placed-but-not-yet-run) can still be edited,
# though a placed sample is limited to its loading parameters (see update_placed_sample_metadata).
_LOCKED_EDIT_STATUSES = ("completed", "failed", "cancelled")


@router.patch("/{sample_id}", response_model=SampleOut)
def update_sample(sample_id: int, req: SampleUpdate, db: SessionDep, actor: ActorDep) -> SampleOut:
    """Edit a sample. A backlog sample is fully editable (everything on the add form except
    the Pool ID, which is fixed once created). A sample already placed on the grid
    (scheduled/in_progress) is edited from the slot-detail popover and is limited to its
    loading/annotation parameters — its barcodes, Sanger IDs, and parent are frozen at
    placement (the barcodes are burned onto the cell use), so any barcode/sanger/parent
    fields in the request are ignored for it. A finished sample can no longer be edited."""
    sample = db.get(Sample, sample_id, options=[selectinload(Sample.barcodes)])
    if sample is None:
        raise HTTPException(404, "Sample not found")
    if sample.status in _LOCKED_EDIT_STATUSES:
        raise HTTPException(409, f"A {sample.status} sample can no longer be edited")

    if sample.status == "backlog":
        barcodes = split_barcodes(" ".join(req.barcodes))
        if not barcodes:
            raise HTTPException(422, "At least one barcode is required")
        update_backlog_sample(
            db,
            sample,
            barcodes=barcodes,
            sanger_ids=req.sanger_ids,
            plate_id=req.plate_id,
            target_oplc=req.target_oplc,
            actual_oplc=req.actual_oplc,
            cleaned_complex_volume=req.cleaned_complex_volume,
            loading_buffer_volume=req.loading_buffer_volume,
            adaptive_loading=req.adaptive_loading,
            full_resolution_base_q=req.full_resolution_base_q,
            priority=req.priority,
            base_kinetics=req.base_kinetics,
            movie_time_hours=req.movie_time_hours,
            insert_size_bp=req.insert_size_bp,
        )
    else:
        update_placed_sample_metadata(
            sample,
            target_oplc=req.target_oplc,
            actual_oplc=req.actual_oplc,
            cleaned_complex_volume=req.cleaned_complex_volume,
            loading_buffer_volume=req.loading_buffer_volume,
            adaptive_loading=req.adaptive_loading,
            full_resolution_base_q=req.full_resolution_base_q,
            priority=req.priority,
            base_kinetics=req.base_kinetics,
        )
    db.add(AuditLog(actor=actor, action="update_sample", entity_type="sample", entity_id=sample.id, details_json={}))
    db.commit()
    db.refresh(sample)
    return sample_out(sample)


@router.post("/{sample_id}/cancel", response_model=SampleOut)
def cancel_sample(sample_id: int, db: SessionDep, actor: ActorDep) -> SampleOut:
    sample = db.get(Sample, sample_id, options=[selectinload(Sample.barcodes)])
    if sample is None:
        raise HTTPException(404, "Sample not found")
    if sample.status != "backlog":
        raise HTTPException(409, f"Only backlog samples can be cancelled (current status: {sample.status})")
    sample.status = "cancelled"
    db.add(AuditLog(actor=actor, action="cancel_sample", entity_type="sample", entity_id=sample.id, details_json={}))
    db.commit()
    db.refresh(sample)
    return sample_out(sample)


@router.post("/{sample_id}/requeue", response_model=SampleOut)
def requeue_sample(sample_id: int, db: SessionDep, actor: ActorDep) -> SampleOut:
    sample = db.get(Sample, sample_id, options=[selectinload(Sample.barcodes)])
    if sample is None:
        raise HTTPException(404, "Sample not found")
    if sample.status != "failed":
        raise HTTPException(409, f"Only failed samples can be requeued (current status: {sample.status})")
    sample.status = "backlog"
    db.add(AuditLog(actor=actor, action="requeue_sample", entity_type="sample", entity_id=sample.id, details_json={}))
    db.commit()
    db.refresh(sample)
    return sample_out(sample)
