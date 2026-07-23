from pydantic import BaseModel

from app.schemas.sample import SampleOut


class ImportRequest(BaseModel):
    raw_text: str
    filename: str | None = None
    actor: str | None = None
    # Field-key -> column-index map confirmed in the review wizard. When present, it takes
    # precedence over auto-detection and rows are parsed against this exact mapping.
    column_map: dict[str, int] | None = None
    # Whether row 0 is a header (stripped) or data. Only consulted on the column_map path.
    has_header: bool = True


class RejectedRow(BaseModel):
    external_id: str
    reason: str


class SkippedRowOut(BaseModel):
    """A row that parsed but wasn't imported (e.g. no barcodes) — an actionable troubleshooting entry."""

    identifier: str
    reason: str


class ImportResult(BaseModel):
    import_batch_id: int
    row_count: int
    imported_count: int
    skipped_count: int
    duplicate_count: int
    warnings: list[str]
    rejected: list[RejectedRow]
    skipped: list[SkippedRowOut] = []
    samples: list[SampleOut]


# --- mapping-review preview (non-committing) ---------------------------------------------


class ImportFieldOut(BaseModel):
    key: str
    label: str
    kind: str
    required: bool
    example: str


class PreviewColumn(BaseModel):
    index: int
    name: str


class ImportPreviewRequest(BaseModel):
    raw_text: str
    has_header: bool = True


class ImportPreviewResult(BaseModel):
    has_header: bool
    columns: list[PreviewColumn]
    suggested_map: dict[str, int]
    # First few data rows as raw cells; the UI renders the mapped preview live from these
    # plus the current column map, so changing a dropdown updates the preview without a round-trip.
    sample_rows: list[list[str]]
    row_count: int
    unmatched_required: list[str]
