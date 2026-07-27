from fastapi import APIRouter, HTTPException, Response
from sqlalchemy import select

from app.api.deps import ActorDep, SessionDep
from app.engine.scheduler_import import SchedulerFormatError
from app.models.importing import ImportBatch
from app.schemas.importing import (
    ImportFieldOut,
    ImportPreviewRequest,
    ImportPreviewResult,
    ImportRequest,
    ImportResult,
    LatestImportOut,
    SchedulerConvertRequest,
    SchedulerConvertResult,
    UndoImportResult,
)
from app.services.import_service import (
    UndoBatchNotFoundError,
    UndoNotAllowedError,
    import_samples,
    importable_fields,
    latest_import,
    preview_import,
    scheduler_convert,
    template_csv,
    undo_import,
)

router = APIRouter(prefix="/api/imports", tags=["imports"])


@router.post("", response_model=ImportResult)
def create_import(req: ImportRequest, db: SessionDep) -> ImportResult:
    return import_samples(db, req)


@router.post("/preview", response_model=ImportPreviewResult)
def preview(req: ImportPreviewRequest) -> ImportPreviewResult:
    """Parse a paste/upload without committing: columns + suggested mapping + sample rows."""
    return preview_import(req.raw_text, req.has_header)


@router.post("/scheduler-convert", response_model=SchedulerConvertResult)
def convert_scheduler(req: SchedulerConvertRequest) -> SchedulerConvertResult:
    """Pool a scheduler-sheet CSV into a standard import CSV (non-committing).

    The scheduler sheet lists one row per sample with a "Portion of SMRT Cell"; sequential
    rows that sum to a whole cell are consolidated into one container. The returned CSV
    flows through the normal preview/mapping/import path unchanged."""
    try:
        return scheduler_convert(req.raw_text)
    except SchedulerFormatError as err:
        raise HTTPException(400, str(err)) from err


@router.get("/fields", response_model=list[ImportFieldOut])
def list_fields() -> list[ImportFieldOut]:
    """The canonical importable fields — target list for the mapping UI and the add-sample form."""
    return importable_fields()


@router.get("/template.csv")
def download_template() -> Response:
    """A blank import template (canonical headers + one example row) to fill and re-import."""
    return Response(
        content=template_csv(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="import-template.csv"'},
    )


@router.get("")
def list_imports(db: SessionDep, page: int = 1, page_size: int = 50) -> dict:
    stmt = select(ImportBatch).order_by(ImportBatch.created_at.desc())
    all_batches = list(db.scalars(stmt).all())
    total_count = len(all_batches)
    start = (page - 1) * page_size
    page_batches = all_batches[start : start + page_size]
    return {
        "items": [
            {
                "id": b.id,
                "created_at": b.created_at,
                "created_by": b.created_by,
                "source_filename": b.source_filename,
                "header_detected": b.header_detected,
                "row_count": b.row_count,
                "imported_count": b.imported_count,
                "skipped_count": b.skipped_count,
                "duplicate_count": b.duplicate_count,
                "warnings": b.warnings,
            }
            for b in page_batches
        ],
        "total": total_count,
    }


@router.get("/latest", response_model=LatestImportOut | None)
def get_latest_import(db: SessionDep) -> LatestImportOut | None:
    """The most recent import batch and whether it can still be undone (null if none exist).
    Registered above /{import_batch_id} so this literal path isn't parsed as an int id."""
    return latest_import(db)


@router.post("/{import_batch_id}/undo", response_model=UndoImportResult)
def undo(import_batch_id: int, db: SessionDep, actor: ActorDep) -> UndoImportResult:
    """Undo an import: delete the samples it created and the batch record. Allowed only for the
    most recent import while every one of its samples is still an untouched backlog row - a 409
    otherwise (samples scheduled/edited, or a newer import exists)."""
    try:
        return undo_import(db, import_batch_id, actor)
    except UndoBatchNotFoundError as err:
        raise HTTPException(404, str(err)) from err
    except UndoNotAllowedError as err:
        raise HTTPException(409, str(err)) from err


@router.get("/{import_batch_id}")
def get_import(import_batch_id: int, db: SessionDep) -> dict:
    batch = db.get(ImportBatch, import_batch_id)
    if batch is None:
        raise HTTPException(404, "Import batch not found")
    return {
        "id": batch.id,
        "created_at": batch.created_at,
        "created_by": batch.created_by,
        "source_filename": batch.source_filename,
        "raw_text": batch.raw_text,
        "header_detected": batch.header_detected,
        "row_count": batch.row_count,
        "imported_count": batch.imported_count,
        "skipped_count": batch.skipped_count,
        "duplicate_count": batch.duplicate_count,
        "warnings": batch.warnings,
    }
