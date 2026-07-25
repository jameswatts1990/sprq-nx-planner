"""reuse_plate_window: the pure day/time arithmetic behind a reuse Plate 2 (Issue: the
reuse used to float to the wrong day). The reuse runs once Plate 1's movie finishes plus the
on-board wash (REUSE_PREP_H), so its day reflects the movie length, not a flat 'next weekday'.
"""
from datetime import datetime, timezone

from app.engine.constants import REUSE_PREP_H
from app.services.placement_service import reuse_plate_window


def _mon_noon() -> datetime:
    # A Monday at noon UTC (2026-07-20 is a Monday).
    return datetime(2026, 7, 20, 12, 0, tzinfo=timezone.utc)


def test_normal_movie_lands_reuse_the_next_weekday():
    # 24h from Mon noon -> Tue noon; + 0.75h wash -> Tue 12:45.
    acquire, start, end = reuse_plate_window(_mon_noon(), 24, 24)
    assert acquire.isoformat() == "2026-07-21"  # Tuesday
    assert start == datetime(2026, 7, 21, 12, 45, tzinfo=timezone.utc)
    assert (end - start).total_seconds() == 24 * 3600  # end = start + the reuse movie


def test_thirty_hour_movie_still_lands_tuesday():
    # 30h (the longest allowed movie) from Mon noon -> Tue 18:00; + wash -> Tue 18:45, still Tue.
    acquire, start, _ = reuse_plate_window(_mon_noon(), 30, 30)
    assert acquire.isoformat() == "2026-07-21"  # Tuesday
    assert start == datetime(2026, 7, 21, 18, 45, tzinfo=timezone.utc)


def test_very_long_movie_pushes_the_reuse_out_a_further_day():
    # A hypothetical 48h movie ends Wed noon; + wash -> Wed 12:45 -> the reuse is Wednesday.
    acquire, start, _ = reuse_plate_window(_mon_noon(), 48, 24)
    assert acquire.isoformat() == "2026-07-22"  # Wednesday


def test_reuse_that_would_start_on_a_weekend_rolls_to_the_next_weekday():
    # Load Friday noon, 30h movie -> ends Sat 18:00; + wash -> Sat 18:45, a weekend. Runs are
    # weekday-only and the operator isn't in, so it rolls to Monday's start hour (noon).
    fri_noon = datetime(2026, 7, 24, 12, 0, tzinfo=timezone.utc)  # 2026-07-24 is a Friday
    acquire, start, _ = reuse_plate_window(fri_noon, 30, 24)
    assert acquire.isoformat() == "2026-07-27"  # Monday
    assert start == datetime(2026, 7, 27, 12, 0, tzinfo=timezone.utc)


def test_reuse_prep_constant_is_actually_applied():
    # Guards that REUSE_PREP_H (previously dead) drives the gap between Plate 1's end and the
    # reuse start, not a fixed clock hour.
    _, start, _ = reuse_plate_window(_mon_noon(), 24, 24)
    plate1_end = _mon_noon().replace(day=21)  # Tue noon
    assert (start - plate1_end).total_seconds() == REUSE_PREP_H * 3600
