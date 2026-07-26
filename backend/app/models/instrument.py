from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Instrument(Base):
    __tablename__ = "instruments"

    id: Mapped[int] = mapped_column(primary_key=True)
    serial_number: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # "Down for maintenance": the date the instrument went down, or NULL when online. Open-ended
    # (down until explicitly brought back online, which clears this). Distinct from `active`,
    # which is the permanent "retired / hidden from the schedule" flag - a down instrument stays
    # visible in the grid, greyed from down_from onward, and refuses new runs from that date.
    down_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    down_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    run_batches: Mapped[list["RunBatch"]] = relationship(back_populates="instrument")
