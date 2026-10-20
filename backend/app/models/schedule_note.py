from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Column, Date, DateTime, ForeignKey, String, Table, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

# Which instruments a schedule note is pinned to. CASCADE both ways: deleting a note drops its
# links, and hard-deleting a mistakenly-added instrument drops its links without touching the
# note's other instruments.
schedule_note_instruments = Table(
    "schedule_note_instruments",
    Base.metadata,
    Column("note_id", ForeignKey("schedule_notes.id", ondelete="CASCADE"), primary_key=True),
    Column("instrument_id", ForeignKey("instruments.id", ondelete="CASCADE"), primary_key=True),
)


class ScheduleNote(Base):
    """A free-text note pinned to one day on one or more instruments (e.g. "Engineer visit -
    don't load before 14:00"), shown as a banner at the top of each of those instrument/day
    cells in the Schedule grid. Purely informational: nothing in scheduling reads it.

    One row per note (not per instrument), so editing or deleting it updates every instrument it
    sits on at once; unpinning a single instrument is an edit to `instruments`."""

    __tablename__ = "schedule_notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    note_date: Mapped[date] = mapped_column(Date, index=True)
    body: Mapped[str] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    instruments: Mapped[list["Instrument"]] = relationship(
        secondary=schedule_note_instruments, order_by="Instrument.serial_number"
    )
