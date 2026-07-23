"""Shared create-one-backlog-sample logic, used by both CSV import and the manual
"Add to backlog" endpoint so the duplicate rule and barcode attachment live in one place."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.sample import SAMPLE_TERMINAL_STATUSES, Sample, SampleBarcode


class DuplicateSampleError(Exception):
    """Raised when an active (non-terminal) sample already exists with the same external_id."""

    def __init__(self, existing: Sample) -> None:
        self.existing = existing
        super().__init__(f"Already active as sample #{existing.id} (status={existing.status})")


def create_backlog_sample(
    db: Session,
    *,
    external_id: str,
    barcodes: list[str],
    sanger_ids: list[str] | None = None,
    parent_sample: str | None = None,
    target_oplc: float | None = None,
    volume: float | None = None,
    adaptive_loading: str | None = None,
    full_resolution_base_q: str | None = None,
    priority: str | None = None,
    ccs_kinetics: str | None = None,
    import_batch_id: int | None = None,
) -> Sample:
    """Insert one backlog Sample + its barcodes. Does NOT commit — the caller owns the
    transaction. Raises DuplicateSampleError if an active sample already has this external_id."""
    existing = db.scalars(
        select(Sample).where(
            Sample.external_id == external_id,
            Sample.status.notin_(SAMPLE_TERMINAL_STATUSES),
        )
    ).first()
    if existing is not None:
        raise DuplicateSampleError(existing)

    sample = Sample(
        import_batch_id=import_batch_id,
        external_id=external_id,
        parent_sample=parent_sample or None,
        sanger_ids=sanger_ids or [],
        target_oplc=target_oplc,
        volume=volume,
        adaptive_loading=adaptive_loading or None,
        full_resolution_base_q=full_resolution_base_q or None,
        priority=priority or None,
        ccs_kinetics=ccs_kinetics or None,
        status="backlog",
    )
    db.add(sample)
    db.flush()
    for i, bc in enumerate(barcodes):
        db.add(SampleBarcode(sample_id=sample.id, barcode=bc, position=i))
    return sample
