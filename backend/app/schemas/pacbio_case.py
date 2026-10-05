from datetime import date, datetime

from pydantic import BaseModel


class PacbioCaseDetailsIn(BaseModel):
    """The hand-entered context of a case logged without a cell. Create and edit both send the
    whole set - edit is a full replace, so an optional field can be cleared."""

    summary: str
    occurred_on: date
    instrument_id: int | None = None
    run_name: str | None = None
    pool_id: str | None = None
    expected_acquisitions: int | None = None


class PacbioCaseCreate(PacbioCaseDetailsIn):
    # Already raised with PacBio? Logging the case number up front starts the case past the
    # "Needs report" stage, the same as Add case number would straight afterwards.
    pacbio_case_number: str | None = None
    credit_notes: str | None = None
    actor: str | None = None


class PacbioCaseUpdate(PacbioCaseDetailsIn):
    actor: str | None = None


class PacbioCaseOut(BaseModel):
    id: int
    summary: str
    occurred_on: date
    instrument_id: int | None
    instrument_serial: str | None
    run_name: str | None
    pool_id: str | None
    expected_acquisitions: int | None
    created_by: str | None
    created_at: datetime
    # PacBio credit workflow - the same stage fields CellOut carries for a cell's case.
    internal_report_id: str | None
    internal_report_at: datetime | None
    pacbio_case_number: str | None
    pacbio_reported_at: datetime | None
    pacbio_credit_confirmed_at: datetime | None
    credit_acquisitions: int | None
    credit_notes: str | None
    credit_received_at: datetime | None
