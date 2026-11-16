"""engine.cell_window: the 108h rule's two halves - the new use's own deadline, and not pushing
an already in-window use out by becoming an earlier Use 1."""
from datetime import datetime, timedelta, timezone

from app.engine.cell_window import window_allows, window_keeps_others

MON = datetime(2026, 11, 16, 9, tzinfo=timezone.utc)
DAY = timedelta(days=1)


def test_a_later_use_inside_the_window_is_allowed_by_both():
    assert window_allows([MON], MON + 2 * DAY)
    assert window_keeps_others([MON], MON + 2 * DAY)


def test_a_later_use_past_the_window_breaks_only_its_own_deadline():
    # Monday's Use 1 + 108h ends Friday 21:00; a Saturday use is itself out of window ...
    late = MON + 5 * DAY
    assert not window_allows([MON], late)
    # ... but it pushes nobody else out, so an explicit (flag-only) choice may keep the cell.
    assert window_keeps_others([MON], late)


def test_an_earlier_insert_that_strands_a_booked_use_fails_both():
    # A Wednesday drop onto a cell whose Use 1 is next Monday becomes the new Use 1 and pulls the
    # deadline to Sunday - next Monday's use would fall out of window.
    next_mon = MON + 7 * DAY
    wed = MON + 2 * DAY
    assert not window_keeps_others([next_mon], wed)
    assert not window_allows([next_mon], wed)


def test_an_already_out_of_window_use_vetoes_nothing():
    # Use 2 already sits past Use 1's window (flagged); inserting doesn't change that.
    assert window_keeps_others([MON, MON + 6 * DAY], MON + 2 * DAY)


def test_a_confirmed_anchor_cannot_be_pushed():
    assert window_keeps_others([MON + 7 * DAY], MON, confirmed_anchor=MON + 7 * DAY)
    assert not window_allows([], MON + 6 * DAY, confirmed_anchor=MON)
