from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.engine.csv_parse import parse_csv
from app.engine.normalize import normalize_samples
from app.models.importing import ImportBatch
from app.models.sample import SAMPLE_TERMINAL_STATUSES, Sample, SampleBarcode
from app.schemas.importing import ImportRequest, ImportResult, RejectedRow
from app.serializers import sample_out


def import_samples(db: Session, req: ImportRequest) -> ImportResult:
    normalized = normalize_samples(req.raw_text)

    all_rows = parse_csv(req.raw_text)
    header_detected = not any(w.startswith("No header row detected") for w in normalized.warnings)
    row_count = max(0, len(all_rows) - (1 if header_detected else 0))
    skipped_count = sum(1 for w in normalized.warnings if "no barcodes" in w)

    batch = ImportBatch(
        created_by=req.actor or "unknown",
        source_filename=req.filename,
        raw_text=req.raw_text,
        header_detected=header_detected,
        row_count=row_count,
        skipped_count=skipped_count,
        warnings=normalized.warnings,
    )
    db.add(batch)
    db.flush()

    created: list[Sample] = []
    rejected: list[RejectedRow] = []
    duplicate_count = 0

    for parsed in normalized.samples:
        existing = db.scalars(
            select(Sample).where(
                Sample.external_id == parsed.id,
                Sample.status.notin_(SAMPLE_TERMINAL_STATUSES),
            )
        ).first()
        if existing is not None:
            duplicate_count += 1
            rejected.append(
                RejectedRow(
                    external_id=parsed.id,
                    reason=f"Already active as sample #{existing.id} (status={existing.status})",
                )
            )
            continue

        sample = Sample(
            import_batch_id=batch.id,
            external_id=parsed.id,
            parent_sample=parsed.parent or None,
            sanger_ids=parsed.sanger,
            oplc=parsed.oplc,
            volume=parsed.volume,
            status="backlog",
        )
        db.add(sample)
        db.flush()
        for i, bc in enumerate(parsed.barcodes):
            db.add(SampleBarcode(sample_id=sample.id, barcode=bc, position=i))
        created.append(sample)

    batch.imported_count = len(created)
    batch.duplicate_count = duplicate_count

    db.commit()
    for s in created:
        db.refresh(s)

    return ImportResult(
        import_batch_id=batch.id,
        row_count=batch.row_count,
        imported_count=batch.imported_count,
        skipped_count=batch.skipped_count,
        duplicate_count=batch.duplicate_count,
        warnings=normalized.warnings,
        rejected=rejected,
        samples=[sample_out(s) for s in created],
    )
