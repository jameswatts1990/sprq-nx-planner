from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

CYCLE_STATUSES = ("planned", "running", "completed", "aborted")
CELL_USE_STATUSES = ("planned", "started", "completed", "failed", "aborted", "cancelled")


class RunBatch(Base):
    """A Run: one SMRT Link run design = one physical load session on one instrument on
    one day. Holds 1-2 Plates (its ``cycles``) that together load up to 8 cells across up
    to two sample plates. Uniquely identified by (instrument, load_date).

    Maps onto the PacBio/SMRT Link "run design" (Plate 1 + Plate 2); see
    docs/pacbio-sprq-nx-scheduling-reference.md. ``run_name`` (e.g. Sanger's
    "TRACTION-RUN-1234") is the run-level Traction ID. Historically this was one
    instrument-day with a single 1:1 Cycle; the Run->Plate split promoted RunBatch to the
    run and Cycle to a plate."""

    __tablename__ = "run_batches"
    __table_args__ = (UniqueConstraint("instrument_id", "load_date", name="uq_run_batch_instrument_load_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id"), index=True)
    # The day the whole run is physically loaded on the instrument (one session). Plate 1
    # acquires on this day; a reuse Plate 2 acquires later but is still loaded now.
    load_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    # Lab-assigned run label (Traction ID), run-level, set at Confirm loaded. Moved here
    # from Cycle in the Run->Plate split - a run has one Traction ID across both plates.
    run_name: Mapped[str | None] = mapped_column(String(128), nullable=True)

    instrument: Mapped["Instrument"] = relationship(back_populates="run_batches")
    cycles: Mapped[list["Cycle"]] = relationship(
        back_populates="run_batch", cascade="all, delete-orphan", order_by="Cycle.plate_index"
    )


class Cycle(Base):
    """A Plate: one acquisition round within a Run (its parent RunBatch). A run has 1-2
    plates (``plate_index`` 1 or 2). Plate 1 acquires on the run's load_date; Plate 2
    acquires the same day when it is a second fresh tray (parallel - the single-use 8-cell
    run) or a later day when it reuses Plate 1's cells (sequential, after the on-board wash).
    Each plate holds up to 4 wells (its ``cell_uses``).

    Run time is per-well (CellUse.run_time_hours) - a deliberate divergence from the vendor's
    "one acquisition time per plate" default; see docs/pacbio-sprq-nx-scheduling-reference.md.
    ``movie_hours`` here is this plate's *representative* (longest) run time, kept in sync by
    placement_service.recompute_cycle_timing; it drives planned_end_at and the instrument lock.
    (Historically this class was 1:1 with RunBatch and modelled the whole run; the Run->Plate
    split promoted RunBatch to the run and this to a plate.)"""

    __tablename__ = "cycles"
    __table_args__ = (UniqueConstraint("run_batch_id", "plate_index", name="uq_cycle_run_plate"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    run_batch_id: Mapped[int] = mapped_column(ForeignKey("run_batches.id", ondelete="CASCADE"), index=True)
    # 1 or 2 - which sample plate / loading position this acquisition round is. server_default
    # is for the migration's existing rows only; every code path sets it explicitly.
    plate_index: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    # The day THIS plate sequences. == run.load_date for Plate 1 (and a same-day parallel
    # Plate 2); a later date for a reuse Plate 2. The chronological anchor for Use 1/2/3.
    acquire_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    # Representative (= longest) run time across this plate's cell_uses; see class docstring.
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
    """One sample loaded on one cell in one well of a plate (its ``cycle``) - the "stage".
    Since ``cycle`` is now a Plate, UniqueConstraint(cycle_id, well) is per-plate: a reused
    cell legitimately appears in the same well (e.g. A01) on both plates of one run - those
    are two different cycle_ids, so they never collide."""

    __tablename__ = "cell_uses"
    __table_args__ = (UniqueConstraint("cycle_id", "well", name="uq_cell_use_cycle_well"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    cycle_id: Mapped[int] = mapped_column(ForeignKey("cycles.id", ondelete="CASCADE"), index=True)
    cell_id: Mapped[int] = mapped_column(ForeignKey("cells.id"), index=True)
    sample_id: Mapped[int | None] = mapped_column(ForeignKey("samples.id"), nullable=True, index=True)
    well: Mapped[str] = mapped_column(String(8))
    # This well's own movie / run time (12/24/30 h). Set from the Run Design "Movie / run
    # time" dial when the sample is placed or auto-scheduled, then editable per-cell from the
    # slot-detail popover. Different wells of the same run may carry different values - the
    # owning Cycle.movie_hours tracks the longest of them (see Cycle docstring). server_default
    # is for the migration's existing rows only; every code path sets it explicitly.
    run_time_hours: Mapped[int] = mapped_column(Integer, nullable=False, server_default="24")
    status: Mapped[str] = mapped_column(String(20), default="planned", index=True)
    # Set by a Cell QC tray re-zip (services/qc_service.py) when a failed/retired cell's
    # loss shifts this acquisition onto a DIFFERENT physical cell than originally planned:
    # holds the cell_id it was planned on. Null = ran on the planned cell. Drives the grid's
    # "reassigned" flag and lets undo restore the original cell.
    reassigned_from_cell_id: Mapped[int | None] = mapped_column(
        ForeignKey("cells.id"), nullable=True
    )
    outcome_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Free-text note the lab user attaches to this sample-on-this-cell placement. Distinct
    # from outcome_notes (which records a QC verdict via Mark Failed / Stop cell): this is a
    # general annotation, editable at any time - including after the run is locked - and
    # surfaced on the slot-detail popover and the printed batch sheet.
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    cycle: Mapped["Cycle"] = relationship(back_populates="cell_uses")
    # foreign_keys pins this to cell_id: there are now two FKs to cells (cell_id and the QC
    # reassigned_from_cell_id), so the relationship join must be disambiguated.
    cell: Mapped["Cell"] = relationship(back_populates="cell_uses", foreign_keys=[cell_id])
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
