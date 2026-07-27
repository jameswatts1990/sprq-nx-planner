from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.engine.normalize import parse_bool_field

# Boolean settings surfaced as True/False in the UI and template.
_BOOL_FIELDS = ("adaptive_loading", "full_resolution_base_q", "ccs_kinetics")


class _SampleFieldsBase(BaseModel):
    """The editable sample fields shared by the manual "Add to backlog" and "Edit backlog
    sample" forms. At least one barcode is required; everything else is optional (mirrors the
    canonical importable-field set). The three boolean settings are validated/normalized to
    "True"/"False". Container ID (external_id) is the sample's identity and lives only on
    SampleCreate — it is set once at creation and never edited."""

    barcodes: list[str] = Field(min_length=1)
    sanger_ids: list[str] = []
    parent_sample: str | None = None
    target_oplc: float | None = None
    volume: float | None = None
    adaptive_loading: str | None = None
    full_resolution_base_q: str | None = None
    priority: str | None = None
    ccs_kinetics: str | None = None

    @field_validator(*_BOOL_FIELDS, mode="before")
    @classmethod
    def _normalize_bool(cls, value: object) -> str | None:
        if value is None:
            return None
        normalized, ok = parse_bool_field(str(value))
        if not ok:
            raise ValueError("must be True or False")
        return normalized


class SampleCreate(_SampleFieldsBase):
    """Manual "Add to backlog" input. external_id (shown as "Container ID") and at least one
    barcode are required; everything else is optional."""

    external_id: str = Field(min_length=1)


class SampleUpdate(_SampleFieldsBase):
    """Manual "Edit backlog sample" input. Same editable fields as create minus the
    Container ID, which identifies the sample and is intentionally not editable."""


class SampleOut(BaseModel):
    id: int
    external_id: str
    parent_sample: str | None
    sanger_ids: list[str]
    target_oplc: float | None
    volume: float | None
    adaptive_loading: str | None
    full_resolution_base_q: str | None
    priority: str | None
    ccs_kinetics: str | None
    status: str
    # QC disposition tag ("repeatable"/"recoverable") when a Cell QC action returned this
    # sample to the backlog - drives the Backlog "Recoverable Samples" section grouping.
    qc_disposition: str | None = None
    barcodes: list[str]
    import_batch_id: int | None
    created_at: datetime
    updated_at: datetime


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
