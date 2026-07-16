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

    instrument: Mapped["Instrument"] = relationship()
    cells: Mapped[list["Cell"]] = relationship(back_populates="tray", order_by="Cell.tray_position")
