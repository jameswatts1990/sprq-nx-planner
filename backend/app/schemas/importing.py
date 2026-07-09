from pydantic import BaseModel

from app.schemas.sample import SampleOut


class ImportRequest(BaseModel):
    raw_text: str
    filename: str | None = None
    actor: str | None = None


class RejectedRow(BaseModel):
    external_id: str
    reason: str


class ImportResult(BaseModel):
    import_batch_id: int
    row_count: int
    imported_count: int
    skipped_count: int
    duplicate_count: int
    warnings: list[str]
    rejected: list[RejectedRow]
    samples: list[SampleOut]
