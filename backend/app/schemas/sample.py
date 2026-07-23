from datetime import datetime

from pydantic import BaseModel, Field


class SampleCreate(BaseModel):
    """Manual "Add to backlog" input. external_id and at least one barcode are required;
    everything else is optional (mirrors the canonical importable-field set)."""

    external_id: str = Field(min_length=1)
    barcodes: list[str] = Field(min_length=1)
    sanger_ids: list[str] = []
    container_id: str | None = None
    parent_sample: str | None = None
    oplc: float | None = None
    target_oplc: float | None = None
    volume: float | None = None
    adaptive_loading: str | None = None
    full_resolution_base_q: str | None = None
    priority: str | None = None
    ccs_kinetics: str | None = None


class SampleOut(BaseModel):
    id: int
    external_id: str
    container_id: str | None
    parent_sample: str | None
    sanger_ids: list[str]
    oplc: float | None
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
