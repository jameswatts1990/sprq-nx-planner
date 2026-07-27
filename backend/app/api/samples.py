from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import ActorDep, SessionDep, pagination
from app.engine.csv_parse import split_barcodes
from app.engine.packing import external_id_sort_key, priority_rank
from app.models.audit import AuditLog
from app.models.sample import SAMPLE_STATUSES, Sample, SampleBarcode
from app.schemas.common import Page
from app.schemas.sample import SampleCreate, SampleDetailOut, SampleOut, SampleUpdate
from app.serializers import sample_detail_out, sample_out
from app.services.sample_service import (
    DuplicateSampleError,
    create_backlog_sample,
    update_backlog_sample,
    update_placed_sample_metadata,
)

router = APIRouter(prefix="/api/samples", tags=["samples"])

SORTABLE_FIELDS = ("created_at", "external_id", "barcode", "priority")


def _first_barcode(sample: Sample) -> str:
    return sample.barcode_list[0] if sample.barcode_list else ""


@router.get("", response_model=Page[SampleOut])
def list_samples(
    db: SessionDep,
    page_info: Annotated[tuple[int, int], Depends(pagination)],
    status: str | None = None,
    q: str | None = None,
    priority: str | None = None,
    sort_by: str = "created_at",
    sort_dir: str = "desc",
) -> Page[SampleOut]:
    """One filterable endpoint covers the backlog (status=backlog) and history
    (status=completed,failed) views - see the plan's API table."""
    page, page_size = page_info
    if sort_by not in SORTABLE_FIELDS:
        raise HTTPException(400, f"Unknown sort_by '{sort_by}'. Valid: {', '.join(SORTABLE_FIELDS)}")
    if sort_dir not in ("asc", "desc"):
        raise HTTPException(400, "sort_dir must be 'asc' or 'desc'")

    stmt = select(Sample).options(selectinload(Sample.barcodes))
    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        for s in statuses:
            if s not in SAMPLE_STATUSES:
                raise HTTPException(400, f"Unknown status '{s}'. Valid: {', '.join(SAMPLE_STATUSES)}")
        stmt = stmt.where(Sample.status.in_(statuses))
    if priority:
        priorities = [p.strip() for p in priority.split(",") if p.strip()]
        stmt = stmt.where(Sample.priority.in_(priorities))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                Sample.external_id.ilike(like),
                Sample.parent_sample.ilike(like),
                Sample.priority.ilike(like),
                Sample.barcodes.any(SampleBarcode.barcode.ilike(like)),
            )
        )

    all_matching = list(db.scalars(stmt.order_by(Sample.created_at.desc())).unique().all())

    reverse = sort_dir == "desc"
    if sort_by == "external_id":
        all_matching.sort(key=lambda s: s.external_id.lower(), reverse=reverse)
    elif sort_by == "barcode":
        all_matching.sort(key=lambda s: _first_barcode(s).lower(), reverse=reverse)
    elif sort_by == "priority":
        # Tie-break equal-rank samples by External ID (natural sort), mirroring the
        # scheduler's processing order (engine/packing.pack_samples) so the Backlog's
        # displayed priority order matches the order samples will actually be packed -
        # and so identical priority labels group together instead of scattering by an
        # arbitrary insertion/created_at order.
        all_matching.sort(
            key=lambda s: (priority_rank(s.priority), external_id_sort_key(s.external_id)),
            reverse=reverse,
        )
    # "created_at" is already the base query order (desc); re-sort only if asc requested
    elif sort_dir == "asc":
        all_matching.reverse()

    total = len(all_matching)
    start = (page - 1) * page_size
    page_items = all_matching[start : start + page_size]
    return Page[SampleOut](items=[sample_out(s) for s in page_items], total=total)


@router.post("", response_model=SampleOut, status_code=201)
def create_sample(req: SampleCreate, db: SessionDep, actor: ActorDep) -> SampleOut:
    """Manually add one sample to the backlog (same landing spot as CSV import)."""
    external_id = req.external_id.strip()
    if not external_id:
        raise HTTPException(422, "Container ID is required")
    barcodes = split_barcodes(" ".join(req.barcodes))
    if not barcodes:
        raise HTTPException(422, "At least one barcode is required")
    try:
        sample = create_backlog_sample(
            db,
            external_id=external_id,
            barcodes=barcodes,
            sanger_ids=req.sanger_ids,
            parent_sample=req.parent_sample,
            target_oplc=req.target_oplc,
            volume=req.volume,
            adaptive_loading=req.adaptive_loading,
            full_resolution_base_q=req.full_resolution_base_q,
            priority=req.priority,
            ccs_kinetics=req.ccs_kinetics,
        )
    except DuplicateSampleError as err:
        raise HTTPException(409, str(err)) from err
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
    return sample_detail_out(sample)


# A sample that has finished its lifecycle - its schedule is history, not a plan, so it's
# read-only. Everything before that (backlog, or placed-but-not-yet-run) can still be edited,
# though a placed sample is limited to its loading parameters (see update_placed_sample_metadata).
_LOCKED_EDIT_STATUSES = ("completed", "failed", "cancelled")


@router.patch("/{sample_id}", response_model=SampleOut)
def update_sample(sample_id: int, req: SampleUpdate, db: SessionDep, actor: ActorDep) -> SampleOut:
    """Edit a sample. A backlog sample is fully editable (everything on the add form except
    the Container ID, which is fixed once created). A sample already placed on the grid
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
            parent_sample=req.parent_sample,
            target_oplc=req.target_oplc,
            volume=req.volume,
            adaptive_loading=req.adaptive_loading,
            full_resolution_base_q=req.full_resolution_base_q,
            priority=req.priority,
            ccs_kinetics=req.ccs_kinetics,
        )
    else:
        update_placed_sample_metadata(
            sample,
            target_oplc=req.target_oplc,
            volume=req.volume,
            adaptive_loading=req.adaptive_loading,
            full_resolution_base_q=req.full_resolution_base_q,
            priority=req.priority,
            ccs_kinetics=req.ccs_kinetics,
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
