from datetime import datetime
from typing import Literal

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
    pool_id: str
    reason: str


class DuplicateNote(BaseModel):
    """A Pool ID that this import created more than one copy of, and/or that was already
    known before the import. Surfaced (not blocked) so the user can Undo if it was unintended.
    Duplicates are a supported workflow — the same sample run across multiple cells."""

    pool_id: str
    created_now: int  # copies created by THIS import
    total_seen: int  # total samples with this Pool ID now (incl. prior + completed)


class SkippedRowOut(BaseModel):
    """A row that parsed but wasn't imported (e.g. no barcodes) — an actionable troubleshooting entry."""

    identifier: str
    reason: str


class ImportResult(BaseModel):
    import_batch_id: int
    row_count: int
    imported_count: int
    skipped_count: int
    # How many imported rows share a Pool ID with another sample (in this file or already
    # in the system). Duplicates are no longer rejected — this is now a "heads up" count, not a
    # drop count — so `rejected` carries only genuinely bad rows, not duplicates.
    duplicate_count: int
    warnings: list[str]
    rejected: list[RejectedRow]
    skipped: list[SkippedRowOut] = []
    # Per-Pool ID summary of what was duplicated, powering the result panel's duplicate
    # notice + Undo recommendation. Only IDs with total_seen > 1 appear.
    duplicates: list[DuplicateNote] = []
    samples: list[SampleOut]


# --- mapping-review preview (non-committing) ---------------------------------------------


class ImportFieldOut(BaseModel):
    key: str
    label: str
    kind: str
    required: bool
    example: str
    # For kind="select": the fixed set of accepted values, rendered as a dropdown on the
    # manual add/edit form (empty for every other field kind).
    choices: list[str] = []
    # True for fields that can be mapped/imported but aren't offered on the manual add/edit
    # form (the value only comes in via import and is shown only on the batch sheet).
    import_only: bool = False


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
    # Pool IDs that repeat WITHIN this file (id -> count), so the mapping-review step can
    # warn before committing. Duplicates are allowed, but an unintended repeat is worth flagging early.
    within_file_duplicates: list[DuplicateNote] = []


# --- scheduler-sheet conversion (pool rows -> standard import CSV) ------------------------


class SchedulerConvertRequest(BaseModel):
    # The scheduler sheet as CSV text (an .xlsx is converted to CSV in the browser first).
    raw_text: str


class SchedulerPoolMember(BaseModel):
    """One source row inside a pool, powering the review breakdown ("3 samples at 33%")."""

    label: str
    portion_percent: int


class SchedulerPool(BaseModel):
    """A pool (one SMRT Cell) formed by grouping scheduler rows on Pool ID. `row` is the
    collapsed, importable line aligned to SchedulerConvertResult.columns; `status` is "ok" when
    the summed portion is a whole cell (auto-included) or "review" when it needs authorising."""

    pool_id: str
    status: Literal["ok", "review"]
    portion_percent: int
    note: str | None = None
    members: list[SchedulerPoolMember]
    row: list[str]


class SchedulerConvertResult(BaseModel):
    # The scheduler rows pooled by Pool ID and carrying every original column. The UI builds the
    # standard import CSV from `columns` + the authorised pools' `row`s, then runs the normal
    # preview/mapping wizard on it. `pools` is index-aligned to those CSV rows.
    columns: list[str]  # original scheduler headers (the Portion column removed)
    pools: list[SchedulerPool]
    source_row_count: int  # rows read from the sheet (header excluded)
    pool_count: int  # pools formed (all statuses)
    review_count: int  # pools needing authorisation
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
