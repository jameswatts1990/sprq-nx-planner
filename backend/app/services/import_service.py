from __future__ import annotations

import csv
import io

from sqlalchemy.orm import Session

from app.engine.csv_parse import parse_csv
from app.engine.import_fields import (
    IMPORTABLE_FIELDS,
    K_BARCODES,
    K_EXTERNAL_ID,
    REQUIRED_KEYS,
    suggest_column_map,
)
from app.engine.normalize import normalize_samples, normalize_with_map
from app.engine.scheduler_import import convert_scheduler_csv
from app.engine.tracker_import import looks_like_tracker, normalize_tracker
from app.models.importing import ImportBatch
from app.schemas.importing import (
    ImportFieldOut,
    ImportPreviewResult,
    ImportRequest,
    ImportResult,
    PreviewColumn,
    RejectedRow,
    SchedulerConvertResult,
    SkippedRowOut,
)
from app.serializers import sample_out
from app.services.sample_service import DuplicateSampleError, create_backlog_sample

PREVIEW_ROW_LIMIT = 8


def import_samples(db: Session, req: ImportRequest) -> ImportResult:
    all_rows = parse_csv(req.raw_text)

    if req.column_map:
        # Mapping-review wizard: the user has confirmed a field -> column-index map. Strip
        # row 0 only if they said it's a header. This transparent path takes precedence.
        data_rows = all_rows[1:] if req.has_header else all_rows
        normalized = normalize_with_map(data_rows, req.column_map)
        header_detected = req.has_header
    elif looks_like_tracker(all_rows):
        normalized = normalize_tracker(req.raw_text)
        normalized.warnings.insert(0, "Read as sequencing-tracker layout (mapped Traction ID, barcodes, Status…).")
        header_detected = True
    else:
        normalized = normalize_samples(req.raw_text)
        header_detected = not any(w.startswith("No header row detected") for w in normalized.warnings)

    row_count = max(0, len(all_rows) - (1 if header_detected else 0))
    skipped_count = len(normalized.skipped)

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

    created = []
    rejected: list[RejectedRow] = []
    duplicate_count = 0

    for parsed in normalized.samples:
        try:
            sample = create_backlog_sample(
                db,
                external_id=parsed.id,
                barcodes=parsed.barcodes,
                sanger_ids=parsed.sanger,
                parent_sample=parsed.parent,
                target_oplc=parsed.target_oplc,
                volume=parsed.volume,
                adaptive_loading=parsed.adaptive_loading,
                full_resolution_base_q=parsed.full_resolution_base_q,
                priority=parsed.priority,
                ccs_kinetics=parsed.ccs_kinetics,
                import_batch_id=batch.id,
            )
        except DuplicateSampleError as err:
            duplicate_count += 1
            rejected.append(RejectedRow(external_id=parsed.id, reason=str(err)))
            continue
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
        skipped=[SkippedRowOut(identifier=s.identifier, reason=s.reason) for s in normalized.skipped],
        samples=[sample_out(s) for s in created],
    )


def preview_import(raw_text: str, has_header: bool = True) -> ImportPreviewResult:
    """Non-committing look at a paste/upload: the file's columns, an auto-suggested
    field->column mapping, and the first few raw rows for the review UI to render."""
    rows = parse_csv(raw_text)
    if not rows:
        return ImportPreviewResult(
            has_header=has_header, columns=[], suggested_map={}, sample_rows=[],
            row_count=0, unmatched_required=list(REQUIRED_KEYS),
        )

    if has_header:
        header = rows[0]
        data = rows[1:]
        columns = [PreviewColumn(index=i, name=(h.strip() or f"Column {i + 1}")) for i, h in enumerate(header)]
        suggested = suggest_column_map(header)
    else:
        width = max(len(r) for r in rows)
        data = rows
        columns = [PreviewColumn(index=i, name=f"Column {i + 1}") for i in range(width)]
        suggested = {K_EXTERNAL_ID: 0} | ({K_BARCODES: 1} if width >= 2 else {})

    unmatched = [k for k in REQUIRED_KEYS if k not in suggested]
    return ImportPreviewResult(
        has_header=has_header,
        columns=columns,
        suggested_map=suggested,
        sample_rows=data[:PREVIEW_ROW_LIMIT],
        row_count=len(data),
        unmatched_required=unmatched,
    )


def scheduler_convert(raw_text: str) -> SchedulerConvertResult:
    """Pool a scheduler-sheet CSV into the app's standard import CSV (non-committing).

    Raises SchedulerFormatError (from the engine) when a required column is missing; the
    API layer turns that into a 400 the user can act on."""
    conversion = convert_scheduler_csv(raw_text)
    return SchedulerConvertResult(
        csv=conversion.csv,
        source_row_count=conversion.source_row_count,
        pool_count=conversion.pool_count,
        warnings=conversion.warnings,
    )


def importable_fields() -> list[ImportFieldOut]:
    return [
        ImportFieldOut(key=f.key, label=f.label, kind=f.kind, required=f.required, example=f.example)
        for f in IMPORTABLE_FIELDS
    ]


def template_csv() -> str:
    """A blank template: canonical field labels as the header + one example row to copy."""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow([f.label for f in IMPORTABLE_FIELDS])
    writer.writerow([f.example for f in IMPORTABLE_FIELDS])
    return buf.getvalue()
