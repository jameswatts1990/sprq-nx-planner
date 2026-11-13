from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Instrument(Base):
    __tablename__ = "instruments"

    id: Mapped[int] = mapped_column(primary_key=True)
    serial_number: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # Physical/asset metadata for the lab's own records - where the instrument lives and its
    # asset-register number. Purely descriptive; nothing in scheduling reads these.
    location: Mapped[str | None] = mapped_column(String(120), nullable=True)
    asset_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Permanent "retired / hidden from the schedule" flag. Temporary out-of-service time is a
    # downtime period instead (below) - a down instrument stays in the grid, greyed on its down days.
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    run_batches: Mapped[list["RunBatch"]] = relationship(back_populates="instrument")
    # Out-of-service periods (models/instrument_downtime.py; rules in services/downtime.py).
    # selectin: every scheduling gate and serializer reads them, and an instrument has a handful.
    downtimes: Mapped[list["InstrumentDowntime"]] = relationship(
        back_populates="instrument",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
        order_by="InstrumentDowntime.start_date",
    )
