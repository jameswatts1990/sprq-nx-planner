from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

SCHEDULE_STATUSES = ("active", "cancelled")
CYCLE_STATUSES = ("planned", "running", "completed", "aborted")
CELL_USE_STATUSES = ("planned", "started", "completed", "failed", "cancelled")


class Schedule(Base):
    """A commit event: the persisted result of one preview -> commit action."""

    __tablename__ = "schedules"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by: Mapped[str] = mapped_column(String(120), default="unknown")
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    settings_json: Mapped[dict] = mapped_column(JSON)
    start_date: Mapped[date] = mapped_column(Date)

    run_batches: Mapped[list["RunBatch"]] = relationship(
        back_populates="schedule", cascade="all, delete-orphan", order_by="RunBatch.batch_index"
    )


class RunBatch(Base):
    """A tray: up to 4 cells run together on one instrument within a schedule."""

    __tablename__ = "run_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    schedule_id: Mapped[int] = mapped_column(ForeignKey("schedules.id", ondelete="CASCADE"), index=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id"), index=True)
    batch_index: Mapped[int] = mapped_column(Integer)

    schedule: Mapped["Schedule"] = relationship(back_populates="run_batches")
    instrument: Mapped["Instrument"] = relationship(back_populates="run_batches")
    cycles: Mapped[list["Cycle"]] = relationship(
        back_populates="run_batch", cascade="all, delete-orphan", order_by="Cycle.use_index"
    )


class Cycle(Base):
    """One movie across a batch at one use-index."""

    __tablename__ = "cycles"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_batch_id: Mapped[int] = mapped_column(ForeignKey("run_batches.id", ondelete="CASCADE"), index=True)
    use_index: Mapped[int] = mapped_column(Integer)
    movie_hours: Mapped[int] = mapped_column(Integer)
    planned_start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    planned_end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    actual_start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    actual_end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="planned", index=True)

    run_batch: Mapped["RunBatch"] = relationship(back_populates="cycles")
    cell_uses: Mapped[list["CellUse"]] = relationship(
        back_populates="cycle", cascade="all, delete-orphan", order_by="CellUse.well"
    )


class CellUse(Base):
    """One sample loaded on one cell for one cycle - the "stage"."""

    __tablename__ = "cell_uses"

    id: Mapped[int] = mapped_column(primary_key=True)
    cycle_id: Mapped[int] = mapped_column(ForeignKey("cycles.id", ondelete="CASCADE"), index=True)
    cell_id: Mapped[int] = mapped_column(ForeignKey("cells.id"), index=True)
    sample_id: Mapped[int | None] = mapped_column(ForeignKey("samples.id"), nullable=True, index=True)
    use_index: Mapped[int] = mapped_column(Integer)
    well: Mapped[str] = mapped_column(String(8))
    status: Mapped[str] = mapped_column(String(20), default="planned", index=True)
    outcome_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    cycle: Mapped["Cycle"] = relationship(back_populates="cell_uses")
    cell: Mapped["Cell"] = relationship(back_populates="cell_uses")
    sample: Mapped["Sample | None"] = relationship(back_populates="cell_uses")
    barcodes: Mapped[list["CellUseBarcode"]] = relationship(back_populates="cell_use", cascade="all, delete-orphan")

    @property
    def barcode_list(self) -> list[str]:
        return [b.barcode for b in self.barcodes]


class CellUseBarcode(Base):
    """Barcode snapshot per cell use - not a live join to Sample, so history stays correct
    even if a sample record is later corrected."""

    __tablename__ = "cell_use_barcodes"

    id: Mapped[int] = mapped_column(primary_key=True)
    cell_use_id: Mapped[int] = mapped_column(ForeignKey("cell_uses.id", ondelete="CASCADE"), index=True)
    barcode: Mapped[str] = mapped_column(String(64), index=True)

    cell_use: Mapped["CellUse"] = relationship(back_populates="barcodes")
