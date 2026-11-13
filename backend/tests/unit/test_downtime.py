"""services/downtime.py's pure rules: inclusive coverage, open-ended periods, current/next, the
weekday maths Stats uses, and the 409 wording a blocked load shows."""
from datetime import date

import pytest

from app.models.instrument import Instrument
from app.models.instrument_downtime import InstrumentDowntime
from app.services import downtime

MON = date(2026, 11, 9)
TUE = date(2026, 11, 10)
WED = date(2026, 11, 11)
FRI = date(2026, 11, 13)
SAT = date(2026, 11, 14)
NEXT_MON = date(2026, 11, 16)


def _p(start, end=None, kind="planned", note=None):
    return InstrumentDowntime(start_date=start, end_date=end, kind=kind, note=note)


def test_coverage_is_inclusive_and_open_ended_runs_forever():
    closed = _p(TUE, WED)
    assert [downtime.covers(closed, d) for d in (MON, TUE, WED, FRI)] == [False, True, True, False]
    assert downtime.covers(_p(TUE), date(2030, 1, 1))
    assert not downtime.covers(_p(TUE), MON)


def test_current_and_next():
    periods = [_p(FRI, SAT), _p(MON, TUE)]
    assert downtime.current_and_next(periods, TUE) == (periods[1], periods[0])
    assert downtime.current_and_next(periods, WED) == (None, periods[0])
    assert downtime.current_and_next(periods, NEXT_MON) == (None, None)


@pytest.mark.parametrize(
    ("first", "last", "expected"),
    [
        (MON, FRI, 5),
        (MON, NEXT_MON, 6),
        (SAT, SAT, 0),
        (FRI, MON, 0),  # backwards = empty
        (MON, date(2026, 12, 6), 20),  # 4 whole weeks
    ],
)
def test_weekdays_in(first, last, expected):
    assert downtime.weekdays_in(first, last) == expected


def test_down_weekdays_clips_to_the_range_and_splits_by_kind():
    periods = [_p(MON, TUE, "planned"), _p(FRI, None, "unplanned")]
    # Range Tue..next Mon: planned Tue (1), unplanned Fri + next Mon (2; the weekend doesn't count).
    assert downtime.down_weekdays(periods, TUE, NEXT_MON) == {"planned": 1, "unplanned": 2}


def test_down_message_names_the_period_and_its_note():
    inst = Instrument(serial_number="84047")
    inst.downtimes = [_p(TUE, WED, "planned", "Laser swap.")]
    assert downtime.down_message(inst, MON) is None
    assert downtime.down_message(inst, WED) == (
        "Instrument 84047 is down for maintenance on 2026-11-11 (10 Nov-11 Nov, planned): Laser swap."
    )
    inst.downtimes = [_p(TUE, kind="unplanned")]
    assert downtime.down_message(inst, FRI) == (
        "Instrument 84047 is down for maintenance on 2026-11-13 (from 10 Nov, unplanned)."
    )
