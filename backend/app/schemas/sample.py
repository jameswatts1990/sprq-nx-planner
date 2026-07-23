from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.engine.normalize import parse_bool_field

# Boolean settings surfaced as True/False in the UI and template.
_BOOL_FIELDS = ("adaptive_loading", "full_resolution_base_q", "ccs_kinetics")


class SampleCreate(BaseModel):
    """Manual "Add to backlog" input. external_id (shown as "Container ID") and at least one
    barcode are required; everything else is optional (mirrors the canonical importable-field
    set). The three boolean settings are validated/normalized to "True"/"False"."""

    external_id: str = Field(min_length=1)
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
    barcodes: list[str]
    import_batch_id: int | None
    created_at: datetime
    updated_at: datetime


class SampleCellUseOut(BaseModel):
    id: int
    cycle_id: int
    run_name: str | None
    run_batch_id: int
    cell_id: int
    cell_code: str
    well: str
    status: str
    started_at: datetime | None
    completed_at: datetime | None
    outcome_notes: str | None


class SampleDetailOut(SampleOut):
    cell_uses: list[SampleCellUseOut] = []
