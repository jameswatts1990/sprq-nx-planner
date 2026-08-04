"""Shared create-one-backlog-sample logic, used by both CSV import and the manual
"Add to backlog" endpoint so the duplicate rule and barcode attachment live in one place."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.engine.normalize import coerce_movie_hours
from app.models.sample import Sample, SampleBarcode
from app.services.settings_service import get_sample_defaults


def existing_samples_with_id(db: Session, external_id: str) -> list[Sample]:
    """Every sample that already carries this Container ID, oldest first — across ALL statuses
    (including completed/cancelled). Duplicates are intentionally allowed (the same sample can be
    run across multiple cells), so this powers the "seen N times" warning/confirm rather than a
    hard rejection. Excludes nothing by status because a container that ran and completed before
    is still meaningful history to flag when it reappears."""
    return list(
        db.scalars(
            select(Sample)
            .where(Sample.external_id == external_id)
            .order_by(Sample.created_at, Sample.id)
        ).all()
    )


def create_backlog_sample(
    db: Session,
    *,
    external_id: str,
    barcodes: list[str],
    sanger_ids: list[str] | None = None,
    parent_sample: str | None = None,
    target_oplc: float | None = None,
    actual_oplc: float | None = None,
    cleaned_complex_volume: float | None = None,
    loading_buffer_volume: float | None = None,
    adaptive_loading: str | None = None,
    full_resolution_base_q: str | None = None,
    priority: str | None = None,
    base_kinetics: str | None = None,
    movie_time_hours: int | None = None,
    insert_size_bp: int | None = None,
    import_batch_id: int | None = None,
) -> Sample:
    """Insert one backlog Sample + its barcodes. Does NOT commit — the caller owns the
    transaction.

    The four defaultable loading options (adaptive_loading, full_resolution_base_q,
    base_kinetics, priority) fall back to the admin-configured sample defaults when left
    unspecified — an explicitly provided value (including an explicit "False") always wins.

    A matching Container ID is NOT rejected: the same sample is deliberately run across multiple
    cells, so each copy is its own backlog row. Callers surface a "seen N times" warning/confirm
    via existing_samples_with_id() instead of blocking here."""
    defaults = get_sample_defaults(db)
    sample = Sample(
        import_batch_id=import_batch_id,
        external_id=external_id,
        parent_sample=parent_sample or None,
        sanger_ids=sanger_ids or [],
        target_oplc=target_oplc,
        actual_oplc=actual_oplc,
        cleaned_complex_volume=cleaned_complex_volume,
        loading_buffer_volume=loading_buffer_volume,
        adaptive_loading=adaptive_loading if adaptive_loading is not None else defaults["adaptive_loading"],
        full_resolution_base_q=full_resolution_base_q
        if full_resolution_base_q is not None
        else defaults["full_resolution_base_q"],
        priority=priority or defaults["priority"],
        base_kinetics=base_kinetics if base_kinetics is not None else defaults["base_kinetics"],
        movie_time_hours=coerce_movie_hours(movie_time_hours),
        insert_size_bp=insert_size_bp,
        status="backlog",
    )
    db.add(sample)
    db.flush()
    for i, bc in enumerate(barcodes):
        db.add(SampleBarcode(sample_id=sample.id, barcode=bc, position=i))
    return sample


def update_backlog_sample(
    db: Session,
    sample: Sample,
    *,
    barcodes: list[str],
    sanger_ids: list[str] | None = None,
    parent_sample: str | None = None,
    target_oplc: float | None = None,
    actual_oplc: float | None = None,
    cleaned_complex_volume: float | None = None,
    loading_buffer_volume: float | None = None,
    adaptive_loading: str | None = None,
    full_resolution_base_q: str | None = None,
    priority: str | None = None,
    base_kinetics: str | None = None,
    movie_time_hours: int | None = None,
    insert_size_bp: int | None = None,
) -> Sample:
    """Overwrite an existing backlog Sample's editable fields and replace its barcode set.
    The sample's identity (external_id / Container ID) is intentionally left untouched.
    Does NOT commit — the caller owns the transaction. Edits store exactly what's given
    (no default-filling — defaults only apply to brand-new samples)."""
    sample.parent_sample = parent_sample or None
    sample.sanger_ids = sanger_ids or []
    sample.target_oplc = target_oplc
    sample.actual_oplc = actual_oplc
    sample.cleaned_complex_volume = cleaned_complex_volume
    sample.loading_buffer_volume = loading_buffer_volume
    sample.adaptive_loading = adaptive_loading or None
    sample.full_resolution_base_q = full_resolution_base_q or None
    sample.priority = priority or None
    sample.base_kinetics = base_kinetics or None
    sample.movie_time_hours = coerce_movie_hours(movie_time_hours)
    sample.insert_size_bp = insert_size_bp

    # Replace barcodes. Clear + flush deletes the old rows first, so re-adding an unchanged
    # barcode doesn't collide with the uq_sample_barcode (sample_id, barcode) constraint
    # (which it would if the insert were ordered before the delete in a single flush).
    sample.barcodes.clear()
    db.flush()
    for i, bc in enumerate(barcodes):
        sample.barcodes.append(SampleBarcode(barcode=bc, position=i))
    return sample


def update_placed_sample_metadata(
    sample: Sample,
    *,
    target_oplc: float | None = None,
    actual_oplc: float | None = None,
    cleaned_complex_volume: float | None = None,
    loading_buffer_volume: float | None = None,
    adaptive_loading: str | None = None,
    full_resolution_base_q: str | None = None,
    priority: str | None = None,
    base_kinetics: str | None = None,
) -> Sample:
    """Update only the loading/annotation parameters that stay editable once a sample has
    left the backlog and been placed on the grid (status scheduled/in_progress). The
    loading-dilution volumes are included — they only feed the batch sheet, which is printed
    for an already-scheduled run, so editing them post-placement is exactly the common case.
    The sample's identity (external_id), its barcodes, Sanger IDs, and parent are deliberately
    frozen at placement time — the barcodes in particular are burned onto the cell use when
    it's scheduled (see run_serializer._stage_out), so a later sample-record edit must not
    diverge from what the cell already carries. Sets attributes on the tracked ORM object
    only; the caller owns the flush/commit (no barcode rows to reconcile, so no `db` needed)."""
    sample.target_oplc = target_oplc
    sample.actual_oplc = actual_oplc
    sample.cleaned_complex_volume = cleaned_complex_volume
    sample.loading_buffer_volume = loading_buffer_volume
    sample.adaptive_loading = adaptive_loading or None
    sample.full_resolution_base_q = full_resolution_base_q or None
    sample.priority = priority or None
    sample.base_kinetics = base_kinetics or None
    return sample
