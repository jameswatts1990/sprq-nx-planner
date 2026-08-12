from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

SAMPLE_STATUSES = ("backlog", "scheduled", "in_progress", "completed", "failed", "cancelled")
SAMPLE_TERMINAL_STATUSES = ("completed", "cancelled")


class Sample(Base):
    __tablename__ = "samples"

    id: Mapped[int] = mapped_column(primary_key=True)
    import_batch_id: Mapped[int | None] = mapped_column(ForeignKey("import_batches.id"), nullable=True)
    # The sample's identity, surfaced to lab users as "Pool ID" (see the import-field spec).
    pool_id: Mapped[str] = mapped_column(String(255), index=True)
    # Optional plate identifier (was "Parent Sample" / parent_sample before v0.52.0), surfaced
    # to lab users as "Plate ID" and round-tripping with the tracker sheet's "Plate ID" column.
    plate_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sanger_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    target_oplc: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Actual (achieved) on-plate loading concentration, distinct from the planned target_oplc.
    # Round-trips with the tracker sheet's "Loading Conc. (pM)" column.
    actual_oplc: Mapped[float | None] = mapped_column(Float, nullable=True)
    # The complex-loading dilution volumes taken from the scheduler sheet (all optional).
    # They pre-fill the batch sheet's SOP 7.3 dilution worksheet and are editable on the
    # sample add/edit form (and the placed-sample slot popover) like every other optional
    # loading parameter. Nullable like every other optional import field.
    cleaned_complex_volume: Mapped[float | None] = mapped_column(Float, nullable=True)
    loading_buffer_volume: Mapped[float | None] = mapped_column(Float, nullable=True)
    adaptive_loading: Mapped[str | None] = mapped_column(String(20), nullable=True)
    full_resolution_base_q: Mapped[str | None] = mapped_column(String(20), nullable=True)
    priority: Mapped[str | None] = mapped_column(String(50), nullable=True)
    base_kinetics: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Desired movie / acquisition time (h), one of 12/24/30. Nullable for rows created
    # before this field existed; a null reads as the 24h default everywhere it's used (the
    # backlog card, and the manual-placement run-time default in placement_service). New
    # rows are always written a concrete value (see engine.normalize.coerce_movie_hours).
    movie_time_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Library insert / fragment size in base pairs (optional). Drives the "[<5kb]" card flag
    # and Auto Schedule's small-insert-on-first-use rule (see engine.packing and
    # DEFAULT_INSERT_SIZE_REUSE_THRESHOLD_BP). Nullable like every other optional import field;
    # a null means "not recorded" and never counts as small.
    insert_size_bp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="backlog", index=True)
    # QC disposition tag when a Cell QC action sends this sample back to the backlog:
    # None | "repeatable_complex" | "repeatable" | "recoverable" (the full set is schemas/qc.py
    # DISPOSITIONS minus "lost", which goes to the top-up list instead). An edit-proof grouping
    # key for the Backlog's "Recoverable Samples" section (priority is free-text/user-editable and
    # shares rank 0 with "Aborted (0)", so it can't be relied on for grouping). Paired with a
    # rank-0 priority label (REPEATABLE_PRIORITY for either repeat pathway, RECOVERABLE_PRIORITY
    # for "recoverable") that drives the ordering. Cleared when the sample is next placed. See
    # services/qc_service.py.
    qc_disposition: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    import_batch: Mapped["ImportBatch | None"] = relationship(back_populates="samples")
    barcodes: Mapped[list["SampleBarcode"]] = relationship(
        back_populates="sample", cascade="all, delete-orphan", order_by="SampleBarcode.position"
    )
    cell_uses: Mapped[list["CellUse"]] = relationship(back_populates="sample")
    topups: Mapped[list["SampleTopup"]] = relationship(
        back_populates="sample", cascade="all, delete-orphan"
    )

    @property
    def barcode_list(self) -> list[str]:
        return [b.barcode for b in self.barcodes]


class SampleBarcode(Base):
    __tablename__ = "sample_barcodes"
    __table_args__ = (UniqueConstraint("sample_id", "barcode", name="uq_sample_barcode"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    sample_id: Mapped[int] = mapped_column(ForeignKey("samples.id", ondelete="CASCADE"), index=True)
    barcode: Mapped[str] = mapped_column(String(64), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)

    sample: Mapped["Sample"] = relationship(back_populates="barcodes")
