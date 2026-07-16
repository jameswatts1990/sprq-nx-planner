"""Cell-reuse packing, ported from revio-nx-planner.html's packCells (lines 431-466)."""
from __future__ import annotations

import re
from datetime import datetime, timezone

from app.engine.constants import CELL_MAX_USES
from app.engine.csv_parse import split_barcodes
from app.engine.types import ConflictPair, PackedCell, PackResult, ParsedSample, PriorCellInput

_PRIORITY_RANK_RE = re.compile(r"\((\d+)\)\s*$")
_UNRANKED_PRIORITY = 999
_EPOCH = datetime.min.replace(tzinfo=timezone.utc)


def priority_rank(priority: str | None) -> int:
    """Lower is higher-priority. Extracts the trailing "(N)" from labels like
    "High (1)"/"Standard (3)"; unlabelled priorities sort after all ranked ones. Shared
    with the Backlog table's own priority sort (app/api/samples.py) so scheduling order
    and the UI's displayed order always agree."""
    if not priority:
        return _UNRANKED_PRIORITY
    m = _PRIORITY_RANK_RE.search(priority)
    return int(m.group(1)) if m else _UNRANKED_PRIORITY


def disjoint(set_a: set[str], arr_b: list[str]) -> bool:
    return not any(b in set_a for b in arr_b)


def pack_cells(
    samples: list[ParsedSample],
    max_uses: int,
    objective: str,
    prior_cells: list[PriorCellInput] | None = None,
    available_days: int | None = None,
) -> PackResult:
    """`max_uses` is this batch's target packing depth for newly-created cells (how many
    uses to plan onto a fresh cell before opening another one) - the user's explicit
    choice, always honored in full. It is not a per-cell physical cap - every cell's real
    capacity is always CELL_MAX_USES.

    `available_days`, when given, additionally caps that depth to the number of distinct
    calendar dates actually on offer in this batch: a cell can only be reused once per
    calendar day (see fill_slots' strictly-later-date rule), so planning a chain deeper
    than that can never actually be placed - it would just strand samples as unplaced
    rather than spreading them across more fresh cells that could have been placed today.
    This applies equally to a *prior* cell with several uses still remaining (e.g. an
    open, never-yet-used sibling from the same physical tray as an already-used cell -
    see cell_service.open_new_tray()): without this cap, a single-day batch could plan
    all 3 of its remaining uses onto one such cell, when only 1 could ever actually be
    placed that day, stranding the other 2 samples as unplaced instead of spreading them
    across other open cells/fresh cells that could have taken them today.

    `objective` only breaks ties between reuse candidates that are otherwise equally
    eligible: "fastest" prefers the least-used fresh cell (spreads samples across more
    cells so more can start sooner); "fewest"/"balance" prefer the most-used fresh cell
    (deepens existing cells first, for fewer distinct cells).

    Samples are processed in priority order first (see `priority_rank`), then oldest
    first among equal priority (`created_at` ascending) - so when cells/wells/days are
    scarce, higher-priority (then older) samples get first claim on them. The
    barcode-count/conflict-degree heuristic that used to be the primary sort only kicks
    in as a tie-break within equal priority+age now - it still matters there (it's a
    hardest-to-place-first bin-packing heuristic), just no longer overrides priority."""
    cap = max_uses if available_days is None else min(max_uses, available_days)

    deg: dict[str, int] = {s.key: 0 for s in samples}
    for i in range(len(samples)):
        for j in range(i + 1, len(samples)):
            if not disjoint(set(samples[i].barcodes), samples[j].barcodes):
                deg[samples[i].key] += 1
                deg[samples[j].key] += 1

    ordered = sorted(
        samples,
        key=lambda s: (
            priority_rank(s.priority),
            s.created_at or _EPOCH,
            -len(s.barcodes),
            -deg[s.key],
            s.id,
        ),
    )

    cells: list[PackedCell] = []
    for i, pc in enumerate(prior_cells or []):
        codes = split_barcodes(pc.barcodes_text or "")
        consumed = min(pc.uses_consumed, CELL_MAX_USES)
        cells.append(
            PackedCell(
                id=f"P{i + 1}",
                prior=True,
                prior_barcodes=set(codes),
                uses_consumed=consumed,
                remaining=max(0, CELL_MAX_USES - consumed),
                barcodes=set(codes),
                uses=[],
                cell_id=pc.cell_id,
                pinned_instrument_serial=pc.pinned_instrument_serial,
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
        cands = [
            c
            for c in cells
            if (
                len(c.uses) < (c.remaining if available_days is None else min(c.remaining, available_days))
                if c.prior
                else len(c.uses) < cap
            )
            and disjoint(c.barcodes, s.barcodes)
        ]
        cands.sort(key=lambda c: (0 if c.prior else 1, len(c.uses) if objective == "fastest" else -len(c.uses)))

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
                remaining=CELL_MAX_USES,
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
