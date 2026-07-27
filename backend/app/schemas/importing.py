from datetime import datetime

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


# --- scheduler-sheet conversion (pool rows -> standard import CSV) ------------------------


class SchedulerConvertRequest(BaseModel):
    # The scheduler sheet as CSV text (an .xlsx is converted to CSV in the browser first).
    raw_text: str


class SchedulerConvertResult(BaseModel):
    # A standard import CSV (canonical headers) built by pooling the scheduler rows; the UI
    # drops it straight into the normal preview/mapping wizard.
    csv: str
    source_row_count: int  # rows read from the sheet (header excluded)
    pool_count: int  # completed SMRT-cell pools -> container rows emitted
    warnings: list[str]


# --- undo the most recent import ---------------------------------------------------------


class LatestImportOut(BaseModel):
    """The most recent import batch + whether it can still be undone. Powers the Import
    screen's 'Undo last import' banner."""

    id: int
    created_at: datetime
    created_by: str
    source_filename: str | None
    row_count: int
    imported_count: int
    undoable: bool
    # Why undo is unavailable (samples progressed/edited, or a newer import exists); null when undoable.
    undo_block_reason: str | None = None
    # How many of the batch's samples are no longer pristine (drives the block reason copy).
    blocking_count: int = 0


class UndoImportResult(BaseModel):
    import_batch_id: int
    removed_count: int
