"""cell_timing.compute_timings: the canonical per-cell instrument timeline (breakout -> movie ->
PPA) mirrored by the frontend gantt. Verifies the two capacity limits the PacBio adaptive-loading
slide implies: 4 sequencing lanes (a second tray waits ~28h) and 2 PPA lanes (cells 3 & 4 wait).
The sequencing servers are shared ACROSS runs, so a run loaded onto a busy machine waits too."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.engine.constants import REUSE_PREP_H
from app.services.cell_timing import (
    PPA_H,
    PREP_H,
    CellInput,
    cell_use_movie_end_at,
    compute_timings,
    instrument_timeline,
    run_load_lock_end,
)


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
    # Plate 1 today (base 0, ONE cell so 3 servers stay free), a reuse plate a day later (base 24).
    cells = _tray("day1", 0.0, [0]) + _tray("day2", 24.0, [4])
    t = compute_timings(cells)
    assert t[0].breakout_h == 0
    # The reuse cell finds a free server at its own day's start (not pulled to ~28h): only 1 of 4
    # servers was busy, so cross-run/plate contention doesn't bite here.
    assert t[4].breakout_h == 24


def test_reuse_cell_prep_carries_the_on_board_wash():
    # A first-use cell and a reuse (Use 2/3) cell in the same load group: both break out on the
    # 2h stagger, but the reuse's movie starts REUSE_PREP_H (the 45-min wash) later than a fresh
    # cell would at the same breakout - the wash is extra prep, not a fresh 4h tray breakout.
    fresh = CellInput(key="fresh", slot_index=0, run_time_h=24.0, group_base_h=0.0, group_key="g")
    reuse = CellInput(key="reuse", slot_index=1, run_time_h=24.0, group_base_h=0.0, group_key="g", is_reuse=True)
    t = compute_timings([fresh, reuse])
    assert t["fresh"].movie_start_h == PREP_H  # first use: 4h prep, no wash
    # reuse: same 2h-staggered breakout, + PREP_H + the wash.
    assert t["reuse"].movie_start_h == t["reuse"].breakout_h + PREP_H + REUSE_PREP_H


def test_a_second_run_loaded_while_the_machine_is_full_waits_for_a_server():
    # Run A fills all 4 sequencing servers (a full tray; movies end 28/30/32/34). Run B is a
    # SEPARATE run loaded 5h later on the same instrument - its cells can't break out at +5h, only
    # when A frees a server. This is the cross-run contention the effective-start advisory keys off.
    cells = (
        [CellInput(key=f"a{s}", slot_index=s, run_time_h=24.0, group_base_h=0.0, group_key="A") for s in (0, 1, 2, 3)]
        + [CellInput(key=f"b{s}", slot_index=s, run_time_h=24.0, group_base_h=5.0, group_key="B") for s in (0, 1, 2, 3)]
    )
    t = compute_timings(cells)
    assert [t[f"a{s}"].breakout_h for s in (0, 1, 2, 3)] == [0, 2, 4, 6]
    # Run B pushed to when A's servers free (28/30/32/34), despite its own +5h load time.
    assert [t[f"b{s}"].breakout_h for s in (0, 1, 2, 3)] == [28, 30, 32, 34]


def _cu(cu_id: int, home_well: str, run_time: int = 24):
    return SimpleNamespace(id=cu_id, well=home_well, run_time_hours=run_time, cell=SimpleNamespace(home_well=home_well))


def _cycle(plate_index: int, start: datetime, cell_uses: list):
    return SimpleNamespace(plate_index=plate_index, planned_start_at=start, actual_start_at=None, cell_uses=cell_uses)


def _run(run_id: int, cycles: list):
    return SimpleNamespace(id=run_id, cycles=cycles)


def test_run_load_lock_end_climbs_with_cell_count_last_cell_prep_done():
    """The instrument's load-lock = when its LAST cell finishes prep (breakout + PREP_H), dynamic
    in the cell count — the ladder from the adaptive-loading slide's purple bars. One tray: 4/6/8/
    10h (4h prep, 2h-staggered). A second tray's cells wait for a sequencing lane (~28h): 32-38h."""
    noon = datetime(2026, 8, 3, 12, tzinfo=timezone.utc)
    wells = ["A01", "B01", "C01", "D01", "A02", "B02", "C02", "D02"]

    def lock_hours(n: int) -> float:
        cycles = [_cycle(1, noon, [_cu(i, w) for i, w in enumerate(wells[: min(n, 4)], start=1)])]
        if n > 4:
            cycles.append(_cycle(2, noon, [_cu(i, w) for i, w in enumerate(wells[4:n], start=5)]))
        return (run_load_lock_end(_run(1, cycles)) - noon).total_seconds() / 3600.0

    assert [lock_hours(n) for n in (1, 2, 3, 4)] == [4, 6, 8, 10]
    assert [lock_hours(n) for n in (5, 6, 7, 8)] == [32, 34, 36, 38]


def test_instrument_timeline_pushes_a_busy_runs_effective_start():
    noon = datetime(2026, 8, 3, 12, tzinfo=timezone.utc)
    # Run A: a full 4-cell tray at noon (fills all 4 servers). Run B: one fresh cell 5h later.
    run_a = _run(1, [_cycle(1, noon, [_cu(i, w) for i, w in enumerate(["A01", "B01", "C01", "D01"], start=1)])])
    run_b = _run(2, [_cycle(1, noon + timedelta(hours=5), [_cu(10, "A01")])])
    eff = instrument_timeline([run_a, run_b])
    # Run A starts at its own load; Run B's effective start is pushed to when A frees a server (~+28h),
    # not its requested +5h - this is what the placement advisory reports to the user.
    assert eff[1] == noon
    assert eff[2] == noon + timedelta(hours=28)


def _wire(cell_use_or_uses, cycle, run_batch):
    """Back-wire the SimpleNamespace fixtures' cycle/run_batch references cell_use_timing needs
    (cell_use.cycle.run_batch) - _cu/_cycle/_run above don't set these since the pure
    compute_timings tests never needed them."""
    cycle.run_batch = run_batch
    uses = cell_use_or_uses if isinstance(cell_use_or_uses, list) else [cell_use_or_uses]
    for cu in uses:
        cu.cycle = cycle


def test_cell_use_movie_end_at_matches_compute_timings_for_a_single_cell():
    noon = datetime(2026, 8, 3, 12, tzinfo=timezone.utc)
    cu = _cu(1, "A01")
    cycle = _cycle(1, noon, [cu])
    _wire(cu, cycle, _run(1, [cycle]))
    assert cell_use_movie_end_at(cu) == noon + timedelta(hours=PREP_H + 24)


def test_cell_use_movie_end_at_reflects_stagger_within_a_tray():
    noon = datetime(2026, 8, 3, 12, tzinfo=timezone.utc)
    uses = [_cu(i, w) for i, w in enumerate(["A01", "B01", "C01", "D01"], start=1)]
    cycle = _cycle(1, noon, uses)
    _wire(uses, cycle, _run(1, [cycle]))
    # breakout 0/2/4/6 + PREP_H(4) + 24h movie -> movie ends 28/30/32/34, proving position D
    # (the last to break out) is ready meaningfully later than a flat plate-start assumption.
    assert [cell_use_movie_end_at(u) for u in uses] == [noon + timedelta(hours=h) for h in (28, 30, 32, 34)]


def test_cell_use_movie_end_at_none_when_run_not_loaded():
    cu = _cu(1, "A01")
    cu.cycle = None
    assert cell_use_movie_end_at(cu) is None
