"""Golden-fixture parity test for computeKPIs(), hand-traced against the prototype
with its default settings."""
from app.engine.kpis import compute_kpis
from app.engine.packing import pack_cells
from app.engine.scheduling import schedule_cells


def test_kpis_for_example_csv_match_hand_traced_expectation(example_samples):
    machines = ["84047", "84098"]
    pack = pack_cells(example_samples, max_uses=3, objective="fewest")
    sched = schedule_cells(pack.cells, machines=machines, run_time=24)
    kpi = compute_kpis(pack.cells, sched, machines)

    assert kpi.total_acq == 8
    assert kpi.fresh_cells == 3
    assert kpi.prior_cells == 0
    assert kpi.trays == 1
    assert kpi.nx_cost == 5916  # C1: 3*690 + C2: 3*690 + C3: 2*888
    assert kpi.single_cost == 7960  # 8 * 995
    assert kpi.savings == 2044
    assert kpi.savings_pct == 26
    assert kpi.duration_days == 4
    assert kpi.machines == 2
