from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.engine.constants import normalize_priority
from app.engine.normalize import parse_bool_field

# Boolean settings surfaced as True/False in the UI and template.
_BOOL_FIELDS = ("adaptive_loading", "full_resolution_base_q", "base_kinetics")


class _SampleFieldsBase(BaseModel):
    """The editable sample fields shared by the manual "Add to backlog" and "Edit backlog
    sample" forms. At least one barcode is required; everything else is optional (mirrors the
    canonical importable-field set). The three boolean settings are validated/normalized to
    "True"/"False". Pool ID (pool_id) is the sample's identity and lives only on
    SampleCreate — it is set once at creation and never edited."""

    barcodes: list[str] = Field(min_length=1)
    sanger_ids: list[str] = []
    plate_id: str | None = None
    target_oplc: float | None = None
    actual_oplc: float | None = None
    # Loading-dilution volumes that pre-fill the batch sheet's SOP 7.3 worksheet (all optional).
    # Control Dilution 3 isn't stored - it's a fixed 1 µL printed on the batch sheet.
    cleaned_complex_volume: float | None = None
    loading_buffer_volume: float | None = None
    adaptive_loading: str | None = None
    full_resolution_base_q: str | None = None
    priority: str | None = None
    base_kinetics: str | None = None
    # Desired movie / acquisition time (h). Accepted loosely (12/24/30); the service
    # normalizes anything else to the 24h default (engine.normalize.coerce_movie_hours).
    movie_time_hours: int | None = None
    # Library insert / fragment size (bp). Optional whole number; a null means "not recorded"
    # and never counts as small-insert for the scheduling rule / card flag.
    insert_size_bp: int | None = None

    @field_validator(*_BOOL_FIELDS, mode="before")
    @classmethod
    def _normalize_bool(cls, value: object) -> str | None:
        if value is None:
            return None
        normalized, ok = parse_bool_field(str(value))
        if not ok:
            raise ValueError("must be True or False")
        return normalized

    @field_validator("priority", mode="before")
    @classmethod
    def _normalize_priority(cls, value: object) -> str | None:
        """Coerce a submitted priority to a canonical label (High/Medium/Standard). A blank
        or unrecognized value becomes None, so the create path fills the configured default."""
        if value is None:
            return None
        return normalize_priority(value)


class SampleCreate(_SampleFieldsBase):
    """Manual "Add to backlog" input. pool_id (shown as "Pool ID") and at least one
    barcode are required; everything else is optional."""

    pool_id: str = Field(min_length=1)


class SampleUpdate(_SampleFieldsBase):
    """Manual "Edit backlog sample" input. Same editable fields as create minus the
    Pool ID, which identifies the sample and is intentionally not editable."""


class SampleOut(BaseModel):
    id: int
    pool_id: str
    plate_id: str | None
    sanger_ids: list[str]
    target_oplc: float | None
    actual_oplc: float | None
    cleaned_complex_volume: float | None
    loading_buffer_volume: float | None
    adaptive_loading: str | None
    full_resolution_base_q: str | None
    priority: str | None
    base_kinetics: str | None
    movie_time_hours: int | None
    insert_size_bp: int | None
    status: str
    # QC disposition tag ("repeatable_complex"/"repeatable"/"recoverable") when a Cell QC action
    # returned this sample to the backlog - drives the Backlog "Recoverable Samples" section
    # grouping. See schemas/qc.py DISPOSITIONS for the full set and their meanings.
    qc_disposition: str | None = None
    barcodes: list[str]
    import_batch_id: int | None
    created_at: datetime
    updated_at: datetime
    # Duplicate marker: when this Pool ID appears on more than one sample (across ALL
    # statuses, incl. completed), duplicate_total is that count and duplicate_index is this
    # copy's 1-based position (ordered oldest-first). Both null for a one-off sample — the UI
    # renders the "1/3" badge only when duplicate_total is set.
    duplicate_index: int | None = None
    duplicate_total: int | None = None


class SampleCellUseOut(BaseModel):
    id: int
    cycle_id: int
    run_name: str | None
    run_batch_id: int
    # Which plate (1 or 2) of the run this use was scheduled on - the plate's positional
    # index, inferred from the schedule, not a separate physical plate identifier.
    plate_number: int | None
    cell_id: int
    cell_code: str
    well: str
    status: str
    started_at: datetime | None
    completed_at: datetime | None
    outcome_notes: str | None


class SampleDetailOut(SampleOut):
    cell_uses: list[SampleCellUseOut] = []
