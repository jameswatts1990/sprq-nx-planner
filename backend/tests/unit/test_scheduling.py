"""Golden-fixture parity test for scheduleCells(), hand-traced against the prototype
with its default settings: instruments 84047+84098, 24h movies, "fewest" packing.
"""
from app.engine.packing import pack_cells
from app.engine.scheduling import schedule_cells
from app.engine.types import ParsedSample


def test_schedule_example_csv_matches_hand_traced_expectation(example_samples):
    pack = pack_cells(example_samples, max_uses=3, objective="fewest")
    sched = schedule_cells(pack.cells, machines=["84047", "84098"], run_time=24)

    assert sched.window_flags == []
    assert sched.max_day == 3
    assert sched.duration_days == 4

    # C1+C3 round-robin onto machine 0, C2 alone onto machine 1 (queues assigned by
    # descending future_uses with C1/C2 tied at 3 and C3 trailing at 2)
    by_machine: dict[str, set[str]] = {}
    for c in sched.cycles:
        by_machine.setdefault(c.machine, set()).update(st.cell.id for st in c.stages)
    assert by_machine["84047"] == {"C1", "C3"}
    assert by_machine["84098"] == {"C2"}

    # 3 cycles per machine (one per use-index of the deepest cell in that machine's batch)
    assert len([c for c in sched.cycles if c.machine == "84047"]) == 3
    assert len([c for c in sched.cycles if c.machine == "84098"]) == 3

    # each stage sits in a distinct well within its cycle
    for cycle in sched.cycles:
        wells = [st.well for st in cycle.stages]
        assert len(wells) == len(set(wells))


def test_schedule_flags_a_cell_whose_window_exceeds_108h():
    # a single 3-use cell run back-to-back at 30h movies: span = (3-1)*(30+0.75) = 61.5h,
    # still under 108h - bump run_time further to force a breach.
    samples = [ParsedSample(id=f"S{i}", barcodes=[f"bc{i}"], key=f"S{i}#{i}") for i in range(3)]
    pack = pack_cells(samples, max_uses=3, objective="fewest")
    sched = schedule_cells(pack.cells, machines=["84047"], run_time=60)
    assert len(sched.window_flags) == 1
    assert sched.window_flags[0].cell == "C1"
    assert sched.window_flags[0].span == (3 - 1) * (60 + 0.75)
