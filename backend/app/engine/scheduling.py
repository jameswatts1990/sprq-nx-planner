"""Direct port of scheduleCells from revio-nx-planner.html (lines 468-495)."""
from __future__ import annotations

import math

from app.engine.constants import (
    CELL_LIFETIME_H,
    DAY_START_HOUR,
    FIRST_PREP_H,
    REUSE_PREP_H,
    STAGES_PER_MACHINE,
    WELLS,
)
from app.engine.types import Cycle, PackedCell, ScheduleResult, Stage, WindowFlag


def schedule_cells(cells: list[PackedCell], machines: list[str], run_time: float) -> ScheduleResult:
    m = len(machines) or 1
    ordered = sorted(cells, key=lambda c: (0 if c.prior else 1, -c.future_uses))

    queues: list[list[PackedCell]] = [[] for _ in range(m)]
    for i, c in enumerate(ordered):
        queues[i % m].append(c)

    cycles: list[Cycle] = []
    window_flags: list[WindowFlag] = []

    for mi, q in enumerate(queues):
        cursor = 0.0
        batch_idx = 0
        machine = machines[mi] if mi < len(machines) else str(mi)
        for b in range(0, len(q), STAGES_PER_MACHINE):
            batch = q[b : b + STAGES_PER_MACHINE]
            batch_depth = max(c.future_uses for c in batch)
            first_start = cursor + FIRST_PREP_H

            for u in range(batch_depth):
                start_h = first_start + u * (run_time + REUSE_PREP_H)
                stages: list[Stage] = []
                for si, cell in enumerate(batch):
                    if u < cell.future_uses:
                        stages.append(Stage(cell=cell, sample=cell.uses[u], well=WELLS[si], stage_no=si + 1))
                cycles.append(
                    Cycle(
                        machine_idx=mi,
                        machine=machine,
                        batch_idx=batch_idx,
                        use_idx=u,
                        start_h=start_h,
                        end_h=start_h + run_time,
                        stages=stages,
                    )
                )

            for si, cell in enumerate(batch):
                cell.machine = machine
                cell.stage_no = si + 1
                if cell.total_uses >= 2:
                    span = (cell.total_uses - 1) * (run_time + REUSE_PREP_H)
                    cell.window_h = span
                    if span > CELL_LIFETIME_H:
                        window_flags.append(WindowFlag(cell=cell.id, span=span))

            cursor = first_start + (batch_depth - 1) * (run_time + REUSE_PREP_H) + run_time
            batch_idx += 1

    t0 = DAY_START_HOUR
    max_end_h = 0.0
    for c in cycles:
        abs_start = t0 + c.start_h
        c.day_idx = math.floor(abs_start / 24)
        c.time_of_day = abs_start % 24
        c.end_day_idx = math.floor((t0 + c.end_h) / 24)
        max_end_h = max(max_end_h, c.end_h)

    max_day = max((c.end_day_idx for c in cycles), default=0)
    duration_days = max(1, math.ceil((t0 + max_end_h) / 24) - math.floor(t0 / 24))

    return ScheduleResult(cycles=cycles, window_flags=window_flags, max_day=max_day, duration_days=duration_days)
