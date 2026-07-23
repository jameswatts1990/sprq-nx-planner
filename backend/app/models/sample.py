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
    # Surfaced to lab users as "Container ID" (see the import-field spec); the DB column
    # keeps its historical `external_id` name.
    external_id: Mapped[str] = mapped_column(String(255), index=True)
    parent_sample: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sanger_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    target_oplc: Mapped[float | None] = mapped_column(Float, nullable=True)
    volume: Mapped[float | None] = mapped_column(Float, nullable=True)
    adaptive_loading: Mapped[str | None] = mapped_column(String(20), nullable=True)
    full_resolution_base_q: Mapped[str | None] = mapped_column(String(20), nullable=True)
    priority: Mapped[str | None] = mapped_column(String(50), nullable=True)
    ccs_kinetics: Mapped[str | None] = mapped_column(String(20), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="backlog", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    import_batch: Mapped["ImportBatch | None"] = relationship(back_populates="samples")
    barcodes: Mapped[list["SampleBarcode"]] = relationship(
        back_populates="sample", cascade="all, delete-orphan", order_by="SampleBarcode.position"
    )
    cell_uses: Mapped[list["CellUse"]] = relationship(back_populates="sample")

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
