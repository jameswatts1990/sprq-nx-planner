import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import ActorDep, SessionDep, pagination
from app.models.audit import AuditLog
from app.models.sample import SAMPLE_STATUSES, Sample, SampleBarcode
from app.schemas.common import Page
from app.schemas.sample import SampleDetailOut, SampleOut
from app.serializers import sample_detail_out, sample_out

router = APIRouter(prefix="/api/samples", tags=["samples"])

SORTABLE_FIELDS = ("created_at", "external_id", "barcode", "priority")

_PRIORITY_RANK_RE = re.compile(r"\((\d+)\)\s*$")


def _priority_rank(priority: str | None) -> int:
    """Lower is higher-priority. Extracts the trailing "(N)" from labels like
    "High (1)"/"Standard (3)"; unlabelled priorities sort after all ranked ones."""
    if not priority:
        return 999
    m = _PRIORITY_RANK_RE.search(priority)
    return int(m.group(1)) if m else 999


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
        all_matching.sort(key=_priority_rank, reverse=reverse)
    # "created_at" is already the base query order (desc); re-sort only if asc requested
    elif sort_dir == "asc":
        all_matching.reverse()

    total = len(all_matching)
    start = (page - 1) * page_size
    page_items = all_matching[start : start + page_size]
    return Page[SampleOut](items=[sample_out(s) for s in page_items], total=total)


@router.get("/priorities", response_model=list[str])
def list_priorities(db: SessionDep) -> list[str]:
    """Distinct priority values in use, ranked the same way the table sorts them, so a
    filter dropdown built from this lines up with the Backlog's own priority ordering.
    Registered above /{sample_id} so this literal path isn't shadowed by that int route."""
    values = db.scalars(select(Sample.priority).distinct().where(Sample.priority.isnot(None))).all()
    return sorted(values, key=_priority_rank)


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
