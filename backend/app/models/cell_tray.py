from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class CellTray(Base):
    """A physical SPRQ-Nx SMRT Cell tray of 4 cells, pinned to the instrument it was
    loaded onto - the moment any one of its cells gets a sample, all 4 Cell rows are
    created together (see cell_service.open_new_tray()), not just the one in use.

    Distinct from the grid's own "Tray 1"/"Tray 2" (engine/constants.py's WELLS split),
    which is an instrument deck loading position, not a SMRT Cell shipping tray."""

    __tablename__ = "cell_trays"

    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Reversible "skip reuse / planning disposal" flag. When set, autoschedule (and
    # Recalculate) stop offering any of this tray's cells for reuse - the lab intends to
    # bin the whole tray, so its remaining uses shouldn't be scheduled. Unlike a real
    # discard (Cell.discarded_at) it is advisory and non-terminal: it touches no cell
    # status and cancels no uses, and clearing it (NULL) restores the tray to reuse.
    # Whole-tray by construction; a single cell only ever leaves service on its own via a
    # QC stop (see docs/pacbio-sprq-nx-scheduling-reference.md).
    reuse_disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    instrument: Mapped["Instrument"] = relationship()
    cells: Mapped[list["Cell"]] = relationship(back_populates="tray", order_by="Cell.tray_position")
