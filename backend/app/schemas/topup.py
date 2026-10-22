from datetime import date, datetime

from pydantic import BaseModel


class SampleTopupOut(BaseModel):
    id: int
    sample_id: int
    pool_id: str | None
    sanger_ids: list[str]
    barcodes: list[str]
    priority: str | None
    created_at: datetime
    # Null until "Request Sent" stamps the date the resupply request went to the submitter.
    request_sent_at: date | None
    note: str | None
    created_by: str | None
    # Provenance: which run/cell the loss came from (for the list UI). All nullable - a
    # resupply request outlives the acquisition it came from.
    source_run_name: str | None
    source_cell_code: str | None
    source_well: str | None


class TopupActorRequest(BaseModel):
    actor: str | None = None
