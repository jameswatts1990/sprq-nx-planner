from fastapi import APIRouter, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import ActorDep, SessionDep
from app.models.audit import AuditLog
from app.models.sample import SAMPLE_STATUSES, Sample
from app.schemas.common import Page
from app.schemas.sample import SampleDetailOut, SampleOut
from app.serializers import sample_detail_out, sample_out

router = APIRouter(prefix="/api/samples", tags=["samples"])


@router.get("", response_model=Page[SampleOut])
def list_samples(
    db: SessionDep,
    status: str | None = None,
    q: str | None = None,
    page: int = 1,
    page_size: int = 50,
) -> Page[SampleOut]:
    """One filterable endpoint covers the backlog (status=backlog) and history
    (status=completed,failed) views - see the plan's API table."""
    stmt = select(Sample).options(selectinload(Sample.barcodes))
    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        for s in statuses:
            if s not in SAMPLE_STATUSES:
                raise HTTPException(400, f"Unknown status '{s}'. Valid: {', '.join(SAMPLE_STATUSES)}")
        stmt = stmt.where(Sample.status.in_(statuses))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Sample.external_id.ilike(like), Sample.parent_sample.ilike(like)))

    all_matching = list(db.scalars(stmt.order_by(Sample.created_at.desc())).unique().all())
    total = len(all_matching)
    start = (page - 1) * page_size
    page_items = all_matching[start : start + page_size]
    return Page[SampleOut](items=[sample_out(s) for s in page_items], total=total)


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
