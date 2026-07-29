"""cell_service.cell_ready_at / reuse_not_ready_hours: the advisory-only "is this cell physically
free yet" check layered on cell_timing's per-cell-use movie-end model. Neither function ever
rejects a placement - see docs/pacbio-sprq-nx-scheduling-reference.md's "Deliberate
simplifications" and auto_fill_service.AutoFillResult.reuse_timing_flags."""
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.engine.constants import REUSE_PREP_H
from app.services.cell_service import cell_ready_at, reuse_not_ready_hours
from app.services.cell_timing import PREP_H

MONDAY = date(2026, 8, 3)
TUESDAY = date(2026, 8, 4)
WEDNESDAY = date(2026, 8, 5)
NOON_MON = datetime(2026, 8, 3, 12, tzinfo=timezone.utc)


def _cell_use(use_id: int, acquire_date: date, planned_start: datetime, run_time: int = 24, status: str = "planned"):
    cycle = SimpleNamespace(
        acquire_date=acquire_date, plate_index=1, planned_start_at=planned_start, actual_start_at=None
    )
    cu = SimpleNamespace(id=use_id, well="A01", run_time_hours=run_time, status=status, cycle=cycle)
    cycle.cell_uses = [cu]
    cycle.run_batch = SimpleNamespace(cycles=[cycle])
    return cu


def _cell(uses: list):
    cell = SimpleNamespace(cell_uses=uses, home_well="A01")
    for u in uses:
        u.cell = cell
    return cell


# Monday noon, 24h movie -> breakout 0 (only cell in its tray) + PREP_H(4) + 24h = movie ends at
# +28h = Tuesday 16:00; ready for reuse at +REUSE_PREP_H(0.75h) = Tuesday 16:45.
USE1_READY_AT = NOON_MON + timedelta(hours=PREP_H + 24 + REUSE_PREP_H)


def test_cell_ready_at_none_for_unused_cell():
    assert cell_ready_at(_cell([])) is None


def test_cell_ready_at_is_movie_end_plus_reuse_prep_h():
    use1 = _cell_use(1, MONDAY, NOON_MON)
    _cell([use1])
    assert cell_ready_at(use1.cell) == USE1_READY_AT


def test_reuse_not_ready_hours_none_for_first_use():
    use1 = _cell_use(1, MONDAY, NOON_MON)
    _cell([use1])
    assert reuse_not_ready_hours(use1) is None


def test_reuse_not_ready_hours_flags_a_premature_second_use():
    use1 = _cell_use(1, MONDAY, NOON_MON)
    # Tuesday 08:00 - well before use1's real ready time of Tuesday 16:45.
    use2 = _cell_use(2, TUESDAY, datetime(2026, 8, 4, 8, tzinfo=timezone.utc))
    _cell([use1, use2])
    shortfall = reuse_not_ready_hours(use2)
    assert shortfall is not None
    assert shortfall == pytest.approx(8.75)


def test_reuse_not_ready_hours_none_when_start_is_safely_after_ready():
    use1 = _cell_use(1, MONDAY, NOON_MON)
    # Wednesday noon - safely after use1's real ready time of Tuesday 16:45.
    use2 = _cell_use(2, WEDNESDAY, datetime(2026, 8, 5, 12, tzinfo=timezone.utc))
    _cell([use1, use2])
    assert reuse_not_ready_hours(use2) is None
