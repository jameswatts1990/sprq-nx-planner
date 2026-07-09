from datetime import datetime

from pydantic import BaseModel


class SampleOut(BaseModel):
    id: int
    external_id: str
    parent_sample: str | None
    sanger_ids: list[str]
    oplc: float | None
    volume: float | None
    status: str
    barcodes: list[str]
    import_batch_id: int | None
    created_at: datetime
    updated_at: datetime


class SampleCellUseOut(BaseModel):
    id: int
    cycle_id: int
    schedule_id: int
    cell_id: int
    cell_code: str
    use_index: int
    well: str
    status: str
    started_at: datetime | None
    completed_at: datetime | None
    outcome_notes: str | None


class SampleDetailOut(SampleOut):
    cell_uses: list[SampleCellUseOut] = []
