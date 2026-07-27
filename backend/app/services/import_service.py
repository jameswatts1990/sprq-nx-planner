from __future__ import annotations

import csv
import io
from typing import NamedTuple

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

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
from app.models.audit import AuditLog
from app.models.importing import ImportBatch
from app.models.sample import Sample
from app.schemas.importing import (
    ImportFieldOut,
    ImportPreviewResult,
    ImportRequest,
    ImportResult,
    LatestImportOut,
    PreviewColumn,
    RejectedRow,
    SchedulerConvertResult,
    SkippedRowOut,
    UndoImportResult,
)
from app.serializers import sample_out
from app.services.sample_service import DuplicateSampleError, create_backlog_sample

PREVIEW_ROW_LIMIT = 8


class UndoNotAllowedError(Exception):
    """Raised when an import batch can't be undone (not the most recent, or some of its
    samples have already been progressed/edited). The API layer maps it to a 409."""


class UndoBatchNotFoundError(Exception):
    """Raised when the import batch to undo doesn't exist. The API layer maps it to a 404."""


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
                movie_time_hours=parsed.movie_time,
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


# --- undo the most recent import ---------------------------------------------------------
#
# An import can be reversed - but only while it's still exactly as it landed: the most recent
# batch, with every sample it created still an untouched backlog row. Once any of those
# samples has been *progressed* (scheduled onto a run, cancelled, completed, top-up requested,
# flagged by Cell QC) or *edited*, undoing would silently discard real downstream work, so it's
# refused. This mirrors the product rule the lab asked for: undo is a safety net for a wrong
# file / bad mapping caught immediately, not a way to unwind samples already in flight.


class _UndoEligibility(NamedTuple):
    undoable: bool
    reason: str | None
    blocking_count: int  # how many of the batch's samples are no longer pristine


def _latest_batch(db: Session) -> ImportBatch | None:
    """The most recent import batch (id breaks a created_at tie deterministically)."""
    return db.scalar(
        select(ImportBatch).order_by(ImportBatch.created_at.desc(), ImportBatch.id.desc()).limit(1)
    )


def _sample_touched(sample: Sample, *, edited: bool) -> bool:
    """True if this sample is no longer the pristine backlog row the import created - it's been
    progressed or edited, so its batch can't be cleanly undone.

    - status != backlog: scheduled/completed/failed/cancelled - progressed off the backlog.
    - any cell_uses: currently placed on the grid.
    - any topups: a lost-sample top-up was requested against it.
    - qc_disposition set: a Cell QC action tagged it.
    - updated_at > created_at: the row was mutated at least once (an edit, or a
      schedule-then-clear that bounced it back to the backlog).
    - edited: an `update_sample` audit entry exists (a backstop that also catches a
      barcode-only edit, which may not bump updated_at if no scalar field changed)."""
    if sample.status != "backlog":
        return True
    if sample.cell_uses:
        return True
    if sample.topups:
        return True
    if sample.qc_disposition is not None:
        return True
    if sample.updated_at is not None and sample.created_at is not None and sample.updated_at > sample.created_at:
        return True
    return edited


def _blocking_count(db: Session, batch_id: int) -> int:
    """How many of a batch's samples have been progressed/edited since import (0 == undoable)."""
    samples = list(
        db.scalars(
            select(Sample)
            .where(Sample.import_batch_id == batch_id)
            .options(selectinload(Sample.cell_uses), selectinload(Sample.topups))
        ).all()
    )
    if not samples:
        return 0
    edited_ids = set(
        db.scalars(
            select(AuditLog.entity_id).where(
                AuditLog.entity_type == "sample",
                AuditLog.action == "update_sample",
                AuditLog.entity_id.in_([s.id for s in samples]),
            )
        ).all()
    )
    return sum(1 for s in samples if _sample_touched(s, edited=s.id in edited_ids))


def _undo_eligibility(db: Session, batch: ImportBatch) -> _UndoEligibility:
    latest = _latest_batch(db)
    if latest is None or latest.id != batch.id:
        return _UndoEligibility(False, "A newer import exists — only the most recent import can be undone.", 0)
    blocking = _blocking_count(db, batch.id)
    if blocking > 0:
        s = "s" if blocking != 1 else ""
        have = "have" if blocking != 1 else "has"
        return _UndoEligibility(
            False,
            f"{blocking} sample{s} from this import {have} already been scheduled or edited, so it can no longer be undone.",
            blocking,
        )
    return _UndoEligibility(True, None, 0)


def latest_import(db: Session) -> LatestImportOut | None:
    """The most recent import batch plus whether it can still be undone - powers the Import
    screen's persistent 'Undo last import' banner. None when nothing has ever been imported."""
    batch = _latest_batch(db)
    if batch is None:
        return None
    elig = _undo_eligibility(db, batch)
    return LatestImportOut(
        id=batch.id,
        created_at=batch.created_at,
        created_by=batch.created_by,
        source_filename=batch.source_filename,
        row_count=batch.row_count,
        imported_count=batch.imported_count,
        undoable=elig.undoable,
        undo_block_reason=elig.reason,
        blocking_count=elig.blocking_count,
    )


def undo_import(db: Session, import_batch_id: int, actor: str | None = None) -> UndoImportResult:
    """Reverse an import: delete every sample it created (barcodes cascade) and the batch
    record itself. Re-checks eligibility inside the write path so a sample scheduled or edited
    between the UI's status read and this call can't be silently discarded. Raises
    UndoBatchNotFoundError (404) / UndoNotAllowedError (409); commits on success."""
    batch = db.get(ImportBatch, import_batch_id)
    if batch is None:
        raise UndoBatchNotFoundError(f"Import batch {import_batch_id} not found")
    elig = _undo_eligibility(db, batch)
    if not elig.undoable:
        raise UndoNotAllowedError(elig.reason or "This import can no longer be undone.")

    source_filename = batch.source_filename
    samples = list(db.scalars(select(Sample).where(Sample.import_batch_id == import_batch_id)).all())
    removed = len(samples)
    for sample in samples:
        db.delete(sample)  # cascades the sample's barcode rows
    db.flush()
    db.delete(batch)
    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="undo_import",
            entity_type="import_batch",
            entity_id=import_batch_id,
            details_json={"removed_count": removed, "source_filename": source_filename},
        )
    )
    db.commit()
    return UndoImportResult(import_batch_id=import_batch_id, removed_count=removed)
