from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class SampleTopup(Base):
    """A request for fresh material ("top-up") because a sample was lost during a Cell QC
    action (disposition "Lost"). Sample-level and deliberately separate from the cell-level
    PacBio credit workflow (models/cell.py) - a top-up is about re-obtaining the sample, a
    credit is about recovering the wasted cell.

    Lifecycle: created when a sample is dispositioned Lost (the sample itself stays
    status="failed"); "Request Sent" stamps request_sent_at; "Cancel" deletes the row.
    A sample can be lost more than once over its lifetime, hence 0..N rows per sample rather
    than columns on Sample. See services/qc_service.py and api/topups.py."""

    __tablename__ = "sample_topups"

    id: Mapped[int] = mapped_column(primary_key=True)
    sample_id: Mapped[int] = mapped_column(ForeignKey("samples.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Null until the lab confirms the top-up request has been sent to the submitter.
    request_sent_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Which acquisition the loss came from, for the list UI's provenance column. SET NULL so
    # a top-up outlives the cell_use row if it is ever deleted.
    source_cell_use_id: Mapped[int | None] = mapped_column(
        ForeignKey("cell_uses.id", ondelete="SET NULL"), nullable=True
    )
    created_by: Mapped[str | None] = mapped_column(String(120), nullable=True)

    sample: Mapped["Sample"] = relationship(back_populates="topups")
    source_cell_use: Mapped["CellUse | None"] = relationship()
