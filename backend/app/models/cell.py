from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

CELL_STATUSES = ("open", "exhausted", "window_expired", "retired", "stopped")


class Cell(Base):
    __tablename__ = "cells"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    max_uses: Mapped[int] = mapped_column(Integer, default=3)
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)
    first_use_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    window_breached: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # QC: cell stopped (all future uses lost) - a terminal, sticky status like "retired".
    stopped_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # QC: PacBio credit tracking. One open case per physical cell at a time, cross
    # referenced by the case number PacBio issues when a quality log is raised.
    pacbio_case_number: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    pacbio_reported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pacbio_credit_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    credit_received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Physical SPRQ-Nx SMRT Cell tray (4 cells) this cell belongs to, and its 1-4 position
    # within it. Null for cells created before this feature or via the one-off
    # bootstrap_cell() cutover tool, which has no way to know real sibling history.
    tray_id: Mapped[int | None] = mapped_column(ForeignKey("cell_trays.id"), nullable=True, index=True)
    tray_position: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # The well (e.g. "C01") this cell is permanently pinned to within its physical tray box
    # from the moment its tray opens - see cell_service.open_new_tray(). Only meaningful
    # while the cell has never been used (current_location() falls back to it); once a
    # cell has a real use, its last CellUse.well takes over as usual.
    home_well: Mapped[str | None] = mapped_column(String(8), nullable=True)

    cell_uses: Mapped[list["CellUse"]] = relationship(back_populates="cell", order_by="CellUse.id")
    tray: Mapped["CellTray | None"] = relationship(back_populates="cells")
