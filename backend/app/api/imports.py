from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.api.deps import SessionDep
from app.models.importing import ImportBatch
from app.schemas.importing import ImportRequest, ImportResult
from app.services.import_service import import_samples

router = APIRouter(prefix="/api/imports", tags=["imports"])


@router.post("", response_model=ImportResult)
def create_import(req: ImportRequest, db: SessionDep) -> ImportResult:
    return import_samples(db, req)


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
