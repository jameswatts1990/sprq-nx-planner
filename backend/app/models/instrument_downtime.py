from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

DOWNTIME_KINDS = ("planned", "unplanned")


class InstrumentDowntime(Base):
    """A period an instrument is out of service (service visit, laser swap, breakdown). Every
    day from start_date to end_date INCLUSIVE is down; end_date NULL = open-ended, down until
    someone brings it back online (which sets end_date). An operational lab constraint, not a
    PacBio-documented behaviour - see docs/pacbio-sprq-nx-scheduling-reference.md,
    "Instrument downtime periods". All rules (gates, overlap, status) live in services/downtime.py.

    Distinct from Instrument.active (permanently retired / hidden from the grid): a down
    instrument stays in the grid, greyed on its down days, and refuses NEW runs loading on them.
    Periods on one instrument never overlap (services/downtime.py refuses with 409)."""

    __tablename__ = "instrument_downtimes"
    __table_args__ = (
        CheckConstraint("kind IN ('planned', 'unplanned')", name="ck_instrument_downtimes_kind"),
        CheckConstraint("end_date IS NULL OR end_date >= start_date", name="ck_instrument_downtimes_dates"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id", ondelete="CASCADE"), index=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # "planned" (booked service visit) or "unplanned" (breakdown) - only Stats tells them apart;
    # both gate scheduling the same way.
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    instrument: Mapped["Instrument"] = relationship(back_populates="downtimes")
