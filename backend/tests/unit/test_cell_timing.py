"""cell_timing.compute_timings: the canonical per-cell instrument timeline (breakout -> movie ->
PPA) mirrored by the frontend gantt. Verifies the two capacity limits the PacBio adaptive-loading
slide implies: 4 sequencing lanes (a second tray waits ~28h) and 2 PPA lanes (cells 3 & 4 wait)."""
from app.services.cell_timing import PPA_H, PREP_H, CellInput, compute_timings


def _tray(group_key: str, base_h: float, slots: list[int], run_time_h: float = 24.0) -> list[CellInput]:
    return [CellInput(key=s, slot_index=s, run_time_h=run_time_h, group_base_h=base_h, group_key=group_key) for s in slots]


def test_single_tray_breaks_out_2h_apart_movie_4h_after():
    t = compute_timings(_tray("g", 0.0, [0, 1, 2, 3]))
    assert [t[s].breakout_h for s in (0, 1, 2, 3)] == [0, 2, 4, 6]
    # Movie (acquiring) starts PREP_H after breakout.
    assert t[0].movie_start_h == PREP_H
    assert t[3].movie_start_h == 6 + PREP_H


def test_second_tray_waits_for_a_sequencing_lane_to_free():
    # One same-session 8-cell run: Plate 1 (slots 0-3) + parallel Plate 2 (slots 4-7), same load.
    t = compute_timings(_tray("g", 0.0, [0, 1, 2, 3, 4, 5, 6, 7]))
    # Tray 1: 2h adaptive stagger from load.
    assert [t[s].breakout_h for s in (0, 1, 2, 3)] == [0, 2, 4, 6]
    # Tray 2: each waits for its lane, which frees at tray-1 movie ends (28/30/32/34), not 2h
    # after cell 4 - reproducing the slide's second-tray-at-~28h cadence.
    assert [t[s].breakout_h for s in (4, 5, 6, 7)] == [28, 30, 32, 34]
    assert t[4].movie_start_h == 28 + PREP_H  # 32


def test_ppa_limited_to_two_lanes_delays_cells_3_and_4():
    t = compute_timings(_tray("g", 0.0, [0, 1, 2, 3]))
    # Movies end at 28/30/32/34; two PPA lanes -> cells 1 & 2 go straight in, 3 & 4 wait ~2h.
    assert t[0].ppa_start_h == 28
    assert t[1].ppa_start_h == 30
    assert t[2].ppa_start_h == 34  # waited for lane (cell 1 freed at 34)
    assert t[3].ppa_start_h == 36  # waited for lane (cell 2 freed at 36)
    assert t[3].ppa_end_h == 36 + PPA_H  # 42 -> ~14h total PPA span across the tray


def test_reuse_plate_on_a_later_day_is_its_own_lane_group():
    # Plate 1 today (base 0), a reuse plate a day later (base 24) with its own fresh lanes.
    cells = _tray("day1", 0.0, [0]) + _tray("day2", 24.0, [4])
    t = compute_timings(cells)
    assert t[0].breakout_h == 0
    # The reuse cell breaks out at its own day's start (not pulled to ~28h by tray-1's lanes).
    assert t[4].breakout_h == 24
