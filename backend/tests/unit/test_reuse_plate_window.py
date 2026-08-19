"""reuse_plate_window: the pure day/time arithmetic behind a reuse Plate 2. The reuse loads once
Plate 1's movie finishes - and Plate 1's movie finishes at load + PREP_H prep + movie (the one
prep-then-movie timing model), so a reuse can't start before the cell physically stops sequencing.
The on-board wash is the reuse cell's OWN prep (cell_timing.REUSE_PREP_H), not a gap here.
"""
from datetime import datetime, timezone

from app.services.cell_timing import coarse_movie_end
from app.services.placement_service import reuse_plate_window


def _mon_noon() -> datetime:
    # A Monday at noon UTC (2026-07-20 is a Monday).
    return datetime(2026, 7, 20, 12, 0, tzinfo=timezone.utc)


def test_normal_movie_lands_reuse_the_next_day():
    # 24h from Mon noon: movie ends Mon noon + 4h prep + 24h = Tue 16:00, where the reuse loads.
    acquire, start, end = reuse_plate_window(_mon_noon(), 24, 24)
    assert acquire.isoformat() == "2026-07-21"  # Tuesday
    assert start == datetime(2026, 7, 21, 16, 0, tzinfo=timezone.utc)
    assert (end - start).total_seconds() == 24 * 3600  # end = start + the reuse movie


def test_thirty_hour_movie_still_lands_tuesday():
    # 30h from Mon noon: ends Mon noon + 4h + 30h = Tue 22:00, where the reuse loads; still Tue.
    acquire, start, _ = reuse_plate_window(_mon_noon(), 30, 30)
    assert acquire.isoformat() == "2026-07-21"  # Tuesday
    assert start == datetime(2026, 7, 21, 22, 0, tzinfo=timezone.utc)


def test_very_long_movie_pushes_the_reuse_out_a_further_day():
    # A hypothetical 48h movie ends Mon noon + 4h + 48h = Wed 16:00 -> the reuse is Wednesday.
    acquire, start, _ = reuse_plate_window(_mon_noon(), 48, 24)
    assert acquire.isoformat() == "2026-07-22"  # Wednesday


def test_reuse_can_start_on_a_weekend():
    # Load Friday noon, 30h movie -> Plate 1's movie ends Fri noon + 4h prep + 30h = Sat 22:00.
    # The reuse plate acquires THEN - Saturday - NOT rolled forward to Monday: the operator loaded
    # on Friday (a weekday) and the machine re-runs the reuse unattended over the weekend. Rolling
    # to Monday used to push a Friday-load reuse out of the cell's 108h window. Only LOAD days are
    # weekday-only; a reuse's own sequencing day may fall on a weekend.
    fri_noon = datetime(2026, 7, 24, 12, 0, tzinfo=timezone.utc)  # 2026-07-24 is a Friday
    acquire, start, _ = reuse_plate_window(fri_noon, 30, 24)
    assert acquire.isoformat() == "2026-07-25"  # Saturday
    assert start == datetime(2026, 7, 25, 22, 0, tzinfo=timezone.utc)  # Sat 22:00 = Fri noon + 4h + 30h


def test_reuse_loads_when_plate1_movie_actually_ends():
    # The reuse loads exactly when Plate 1's movie finishes - which is load + PREP_H prep + movie
    # (coarse_movie_end), NOT load + movie: the cell is still sequencing during Plate 1's prep.
    _, start, _ = reuse_plate_window(_mon_noon(), 24, 24)
    assert start == coarse_movie_end(_mon_noon(), 24)  # Tue 16:00 = Mon noon + 4h prep + 24h movie
