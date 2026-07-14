"""Direct port of computeKPIs from revio-nx-planner.html (lines 497-506)."""
from __future__ import annotations

from app.engine.constants import CELLS_PER_TRAY, COST_BY_DEPTH, SINGLE_USE_PER_ACQ
from app.engine.types import KPIResult, PackedCell, ScheduleResult


def compute_kpis(cells: list[PackedCell], sched: ScheduleResult, machines: list[str]) -> KPIResult:
    total_acq = sum(c.future_uses for c in cells)
    fresh_cells = sum(1 for c in cells if not c.prior)
    prior_cells = sum(1 for c in cells if c.prior)
    trays = -(-fresh_cells // CELLS_PER_TRAY)  # ceil division

    nx_cost = sum(c.future_uses * COST_BY_DEPTH[c.cost_tier] for c in cells)
    single_cost = total_acq * SINGLE_USE_PER_ACQ
    savings = single_cost - nx_cost
    savings_pct = round(savings / single_cost * 100) if single_cost else 0

    return KPIResult(
        total_acq=total_acq,
        fresh_cells=fresh_cells,
        prior_cells=prior_cells,
        trays=trays,
        nx_cost=nx_cost,
        single_cost=single_cost,
        savings=savings,
        savings_pct=savings_pct,
        duration_days=sched.duration_days,
        machines=len(machines),
    )
