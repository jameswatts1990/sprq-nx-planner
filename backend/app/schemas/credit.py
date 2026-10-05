from pydantic import BaseModel

# Request bodies for the PacBio credit-workflow stage actions - shared by a cell's case
# (/api/cells/{id}/...) and a case logged without a cell (/api/pacbio-cases/{id}/...).


class CreditReportToPacbioRequest(BaseModel):
    case_number: str
    actor: str | None = None


class CreditInternalReportRequest(BaseModel):
    # The report ID the failure is filed under internally (e.g. 26_NC_S_004).
    report_id: str
    actor: str | None = None


class CreditConfirmRequest(BaseModel):
    # Number of acquisitions PacBio confirmed they will credit for this case.
    acquisitions: int
    actor: str | None = None


class CreditNotesRequest(BaseModel):
    # Free-text note on the credit case, editable at any stage. Empty clears it.
    notes: str | None = None
    actor: str | None = None


class CreditOwnerRequest(BaseModel):
    # Who is chasing the case (a Sanger ID or a name). Empty clears it.
    owner: str | None = None
    actor: str | None = None


class CreditActorRequest(BaseModel):
    actor: str | None = None
