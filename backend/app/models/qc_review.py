from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class QcReviewIgnore(Base):
    """An MLWH well the lab chose to ignore in the QC page's QC Review queue (services/qc_review.py)
    - e.g. PacBio won't credit it, or the run predates RunNx - with the reason why. The well then
    sits in the queue's Ignored list until restored (which deletes this row). Keyed by the well's
    natural MLWH identity, never MLWH's own row id, which the warehouse says can change."""

    __tablename__ = "qc_review_ignores"

    id: Mapped[int] = mapped_column(primary_key=True)
    # services/qc_review.well_key: "<Traction run name>|<plate number>|<well label>".
    mlwh_well_key: Mapped[str] = mapped_column(String(200), unique=True)
    reason: Mapped[str] = mapped_column(Text)
    ignored_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    ignored_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
