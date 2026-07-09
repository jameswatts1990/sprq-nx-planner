"""Direct port of targetDepthFor / disjoint / packCells from revio-nx-planner.html (lines 431-466)."""
from __future__ import annotations

from app.engine.csv_parse import split_barcodes
from app.engine.types import ConflictPair, PackedCell, PackResult, ParsedSample, PriorCellInput


def target_depth_for(objective: str, max_uses: int) -> int:
    if objective == "fastest":
        return 1
    if objective == "balance":
        return min(max_uses, 2)
    return max_uses


def disjoint(set_a: set[str], arr_b: list[str]) -> bool:
    return not any(b in set_a for b in arr_b)


def pack_cells(
    samples: list[ParsedSample],
    max_uses: int,
    objective: str,
    prior_cells: list[PriorCellInput] | None = None,
) -> PackResult:
    target = target_depth_for(objective, max_uses)

    deg: dict[str, int] = {s.key: 0 for s in samples}
    for i in range(len(samples)):
        for j in range(i + 1, len(samples)):
            if not disjoint(set(samples[i].barcodes), samples[j].barcodes):
                deg[samples[i].key] += 1
                deg[samples[j].key] += 1

    ordered = sorted(samples, key=lambda s: (-len(s.barcodes), -deg[s.key], s.id))

    cells: list[PackedCell] = []
    for i, pc in enumerate(prior_cells or []):
        codes = split_barcodes(pc.barcodes_text or "")
        consumed = min(pc.uses_consumed, max_uses)
        cells.append(
            PackedCell(
                id=f"P{i + 1}",
                prior=True,
                prior_barcodes=set(codes),
                uses_consumed=consumed,
                remaining=max(0, max_uses - consumed),
                barcodes=set(codes),
                uses=[],
                cell_id=pc.cell_id,
            )
        )

    conflict_pairs: list[ConflictPair] = []
    for i in range(len(samples)):
        for j in range(i + 1, len(samples)):
            shared = [b for b in samples[i].barcodes if b in samples[j].barcodes]
            if shared:
                conflict_pairs.append(ConflictPair(a=samples[i].id, b=samples[j].id, shared=shared))

    unplaced: list[ParsedSample] = []
    for s in ordered:
        cap = min(target, max_uses)
        cands = [
            c
            for c in cells
            if (len(c.uses) < c.remaining if c.prior else len(c.uses) < cap) and disjoint(c.barcodes, s.barcodes)
        ]
        cands.sort(key=lambda c: (0 if c.prior else 1, -len(c.uses)))

        if cands:
            c = cands[0]
            c.uses.append(s)
            c.barcodes.update(s.barcodes)
            continue

        if cap < 1:
            unplaced.append(s)
            continue

        fresh_count = sum(1 for x in cells if not x.prior)
        cells.append(
            PackedCell(
                id=f"C{fresh_count + 1}",
                prior=False,
                prior_barcodes=set(),
                uses_consumed=0,
                remaining=max_uses,
                barcodes=set(s.barcodes),
                uses=[s],
            )
        )

    for c in cells:
        c.future_uses = len(c.uses)
        c.total_uses = (c.uses_consumed or 0) + c.future_uses
        c.cost_tier = min(3, max(1, c.total_uses))
        c.window_h = 0.0

    return PackResult(
        cells=[c for c in cells if c.future_uses > 0],
        all_cells=cells,
        unplaced=unplaced,
        conflict_pairs=conflict_pairs,
    )
