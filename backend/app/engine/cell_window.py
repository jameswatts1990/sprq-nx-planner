"""The 108h reuse-window rule as one pure function, shared by the DB-free engine (fill_slots)
and the service layer (manual placement, QC re-zip) so every path agrees on it exactly."""
from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timedelta

from app.engine.constants import CELL_LIFETIME_H

_LIFETIME = timedelta(hours=CELL_LIFETIME_H)


def window_allows(
    existing_starts: Iterable[datetime], new_start: datetime, confirmed_anchor: datetime | None = None
) -> bool:
    """Whether a cell can take one more use starting at `new_start` without breaking its single
    108h window (PacBio: every use must start within 108h of Use 1 - see
    docs/pacbio-sprq-nx-scheduling-reference.md #2).

    `existing_starts` are the planned starts of the cell's other active uses; `confirmed_anchor`
    is its real first-use start once Confirm-loaded, which nothing can move. Until then the
    earliest use is the anchor, so a use inserted EARLIER than every existing one becomes the
    new Use 1 and pulls the deadline forward - it must not push an existing use that is
    in-window today out of the window. A use already out of window (flagged, see
    cell_service.reuse_window_exceeded) doesn't veto anything: it's already broken either way."""
    if confirmed_anchor is not None:
        return new_start <= confirmed_anchor + _LIFETIME
    starts = list(existing_starts)
    if not starts:
        return True
    first = min(starts)
    new_deadline = min(first, new_start) + _LIFETIME
    if new_start > new_deadline:
        return False
    old_deadline = first + _LIFETIME
    return all(s <= new_deadline for s in starts if s <= old_deadline)
