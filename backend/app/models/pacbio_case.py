from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.credit_case import CreditCaseMixin


class PacbioCase(CreditCaseMixin, Base):
    """A PacBio credit case logged by hand WITHOUT a RunNx cell behind it - e.g. a failure on a
    cell the app never tracked, or a credit-worthy loss that isn't a single cell at all. It runs
    through exactly the same credit stages as a cell's own case (CreditCaseMixin) and sits in the
    same QC worklist, but deliberately never touches cells, uses, samples or the schedule.

    Everything a cell's case derives from its failed use (when, instrument/run/sample, how many
    acquisitions to expect back) is typed in instead - only the summary and date are required."""

    __tablename__ = "pacbio_cases"

    id: Mapped[int] = mapped_column(primary_key=True)
    # What happened, in the lab's words - the case's identity in the worklist (a cell case shows
    # its cell code there instead) and the "Problem Statement" of the generated issue report.
    summary: Mapped[str] = mapped_column(String(200))
    # When the failure/loss happened - the Failure stage date and the worklist's age ordering.
    occurred_on: Mapped[date] = mapped_column(Date)
    # Optional context, all free to leave blank. SET NULL so deleting a mistakenly-added
    # instrument never takes a credit case with it.
    instrument_id: Mapped[int | None] = mapped_column(
        ForeignKey("instruments.id", ondelete="SET NULL"), nullable=True
    )
    run_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    pool_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # The lab's own estimate of the acquisitions to claim - a cell case computes this from its
    # max uses and fail use; with no cell it can only be entered. Distinct from the mixin's
    # credit_acquisitions, which is what PacBio actually confirmed.
    expected_acquisitions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    instrument: Mapped["Instrument | None"] = relationship()
