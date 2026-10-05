from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column


class CreditCaseMixin:
    """The PacBio credit-workflow columns shared by both kinds of credit case: a physical cell
    that Failed or was Stopped (models/cell.py - the case lives on the cell itself, one per cell)
    and a case logged by hand with no RunNx cell behind it (models/pacbio_case.py). One column set
    means one set of stage rules (services/credit_service.py) and one QC worklist serve both.

    Stages run in order: PacBio report (case number) -> internal report (its ID feeds off the
    PacBio case number) -> credit confirmed (acquisitions PacBio will credit) -> credit received."""

    # The lab's own write-up of the failure, identified by the report ID it's filed under
    # (e.g. 26_NC_S_004). internal_report_at is stamped on the first save and kept on later edits.
    internal_report_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    internal_report_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The case number PacBio issues when a quality log is raised - the cross-reference for the case.
    pacbio_case_number: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    pacbio_reported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pacbio_credit_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # How many acquisitions PacBio confirmed they will credit, recorded at the confirm step.
    credit_acquisitions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Free-text case note, editable at any stage.
    credit_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    credit_received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
