"""Cell-reuse packing, ported from revio-nx-planner.html's packCells (lines 431-466)."""
from __future__ import annotations

import re
from datetime import datetime, timezone

from app.engine.constants import (
    ALL_CELL_POSITIONS,
    CELL_MAX_USES,
    DEFAULT_INSERT_SIZE_REUSE_THRESHOLD_BP,
    WELLS,
    movie_allowed_positions,
    within_tray_pos,
)
from app.engine.csv_parse import split_barcodes
from app.engine.types import ConflictPair, PackedCell, PackResult, ParsedSample, PriorCellInput

_PRIORITY_RANK_RE = re.compile(r"\((\d+)\)\s*$")
_UNRANKED_PRIORITY = 999
_EPOCH = datetime.min.replace(tzinfo=timezone.utc)
_NATURAL_SORT_CHUNK_RE = re.compile(r"(\d+)")

# Priority label assigned to a sample bumped back to the backlog by a Stop-cell cascade
# (see cell_service.stop_cell) - rank 0 sorts ahead of every existing label under
# priority_rank()'s "Label (N)" convention, so it wins the Backlog sort and the next
# pack_cells() run with no other changes needed.
ABORTED_PRIORITY = "Aborted (0)"

# Priority labels for samples a Cell QC action sends back to the backlog with a
# disposition (see services/qc_service.py). Rank 0, like ABORTED_PRIORITY, so they sort
# above "High (1)" - the "bumped above High" requirement. The distinct labels also let the
# Backlog badge tone tell them apart; grouping into the "Recoverable Samples" section keys
# off Sample.qc_disposition, not these strings.
REPEATABLE_PRIORITY = "Repeatable (0)"
RECOVERABLE_PRIORITY = "Recoverable (0)"


def priority_rank(priority: str | None) -> int:
    """Lower is higher-priority. Extracts the trailing "(N)" from labels like
    "High (1)"/"Standard (3)"; unlabelled priorities sort after all ranked ones. Shared
    with the Backlog table's own priority sort (app/api/samples.py) so scheduling order
    and the UI's displayed order always agree."""
    if not priority:
        return _UNRANKED_PRIORITY
    m = _PRIORITY_RANK_RE.search(priority)
    return int(m.group(1)) if m else _UNRANKED_PRIORITY


def external_id_sort_key(external_id: str) -> tuple[str | int, ...]:
    """Natural (numeric-aware), case-insensitive sort key for an External ID, e.g.
    "Sample 9" sorts before "Sample 10" rather than after (plain string sort would put
    "10" before "9"). Splits the id on runs of digits, lower-cases the text chunks, and
    parses the digit chunks as ints. `re.split`'s capture group always yields text
    chunks at even indices and digit chunks at odd ones regardless of the input, so two
    keys compared position-by-position never mix `str` and `int` at the same index."""
    parts = _NATURAL_SORT_CHUNK_RE.split(external_id or "")
    return tuple(int(p) if i % 2 else p.lower() for i, p in enumerate(parts))


def _movie_constraint_rank(movie_time: int | None) -> int:
    """0 for a position-constrained movie length (12h -> cell 1, 30h -> cell 4), 1 for a
    flexible one (24h, or a missing time that reads as the 24h default). Ordering constrained
    samples first lets them claim their required well before a flexible 24h sample takes it -
    the same "most-constrained first" idea slot_scheduling already uses when laying cells onto
    slots (engine/slot_scheduling.py)."""
    return 0 if movie_allowed_positions(movie_time) != ALL_CELL_POSITIONS else 1


def disjoint(set_a: set[str], arr_b: list[str]) -> bool:
    return not any(b in set_a for b in arr_b)


def _foreign_clash(cell: PackedCell, sample: ParsedSample) -> bool:
    """True if any of `sample`'s barcodes was burned on `cell` by a DIFFERENT Container ID -
    the real reuse-carryover risk (see docs/pacbio-sprq-nx-scheduling-reference.md). A barcode
    this exact Container ID (`sample.id`, an external_id) already burned on the cell itself -
    an earlier duplicate copy of the same sample - is not a clash: it's the same physical
    material either way, so there's no cross-sample misattribution risk (lab owner decision,
    2026-07-29). `cell.barcode_owners` has no entry for a barcode nobody has recorded an owner
    for (a hand-built prior cell with no owner data) - treated as foreign, the same
    unconditional block this guard always had before duplicates existed."""
    for b in sample.barcodes:
        if b not in cell.barcodes:
            continue
        owners = cell.barcode_owners.get(b)
        if not owners or owners - {sample.id}:
            return True
    return False


def cell_allowed_positions(c: PackedCell) -> frozenset[int]:
    """The carousel cell positions (within_tray_pos, 0-3) still open to this whole cell,
    given Auto Schedule's movie-time rule (see engine/constants.movie_allowed_positions).

    A cell is one physical position for life, so every one of its uses must share a
    position: the intersection of each already-assigned use's movie-time allowance, further
    narrowed to the cell's fixed position if it's a prior/pinned cell. Empty means the uses
    already conflict (e.g. a 12h and a 30h use can never share one cell). For the all-24h
    common case this is always the full {0,1,2,3}, so it never constrains anything."""
    positions = ALL_CELL_POSITIONS
    if c.pinned_well is not None:
        positions &= frozenset({within_tray_pos(c.pinned_well)})
    for u in c.uses:
        positions &= movie_allowed_positions(u.movie_time)
    return positions


def _cell_is_first_use(c: PackedCell) -> bool:
    """True if adding a sample to this cell would be its very FIRST use - no uses consumed on a
    prior real cell and none assigned yet this batch. Small-insert libraries are restricted to
    first uses only (see pack_cells)."""
    return (c.uses_consumed or 0) + len(c.uses) == 0


def pack_cells(
    samples: list[ParsedSample],
    max_uses: int,
    objective: str,
    prior_cells: list[PriorCellInput] | None = None,
    available_days: int | None = None,
    cells_per_day: int | None = None,
    insert_size_reuse_threshold: int = DEFAULT_INSERT_SIZE_REUSE_THRESHOLD_BP,
) -> PackResult:
    """`max_uses` is this batch's target packing depth: how many TOTAL uses to plan onto a
    cell before moving on - the user's explicit choice, always honored in full. It bounds
    both newly-created cells (fresh cells get up to `max_uses` uses before another is
    opened) and *prior* reuse cells (a prior cell is planned up to `max_uses - uses_consumed`
    further uses this batch - see `_prior_allowance` below - so the dial applies to reuse
    candidates too, not only to fresh cells). It is not a per-cell physical cap - every
    cell's real capacity is always CELL_MAX_USES; a run with `max_uses < CELL_MAX_USES`
    simply leaves physical capacity unused (auto_fill then disposes such cells once they
    reach the dial - see auto_fill_service).

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
    (deepens existing cells first, for fewer distinct cells). "utilisation" goes further
    than "fastest": it withholds every not-yet-full fresh cell from consideration until
    `cells_per_day` distinct fresh cells are open (falling back to `len(WELLS)` if not
    given), so a run of same-priority samples opens enough physically distinct cells to
    fill a whole instrument-day's wells before any of them is reused for a 2nd/3rd use -
    matching PacBio's own "high-utilization schedule" example of loading a full tray (or
    two) per touch point rather than trickling reuse across fewer cells (see
    docs/pacbio-sprq-nx-scheduling-reference.md's "Instrument load-lock timing" section).
    Once that many fresh cells are open, it behaves exactly like "fastest" (least-used
    first) to round-robin further depth evenly across them.

    "order" ("By Order") is a different axis: it doesn't change the reuse tie-break at all
    (it borrows "utilisation"'s fill-a-whole-tray-before-reusing cell choice, so the grid
    fills day-by-day in sequence rather than deepening one cell across days) - what it
    changes is the SAMPLE processing order below, to strict upload/CSV sequence.

    Samples are processed in priority order first (see `priority_rank`) - that's the
    ruling factor and always wins (EXCEPT under "order", which ignores priority and the
    movie/Container-ID keys entirely and schedules strictly in upload/CSV sequence - see
    the `by_order` branch). Within equal priority, position-constrained movie lengths
    (12h -> cell 1, 30h -> cell 4) are processed before flexible 24h samples (see
    `_movie_constraint_rank`), so they claim their required well first; movie length then
    gives way to External ID sequence (natural/numeric-aware, case-insensitive - see
    `external_id_sort_key`): a lab operator prepping a plate of e.g. "Sample 12".."Sample
    19" wants those loaded and run together, not scattered across cells/days by
    coincidence of upload time. This mostly just orders *processing*, but because the
    greedy loop below fills each cell to capacity before opening the next, it also tends
    to *place* ID-adjacent samples on the same cell/run - grouping them physically, not
    just conceptually. Oldest-first (`created_at` ascending) only breaks a further tie
    where two samples share both priority and External ID (e.g. a container id reused
    across two import rows). The barcode-count/conflict-degree heuristic that used to be
    the primary sort only kicks in as a tie-break after all of the above now - it still
    matters there (it's a hardest-to-place-first bin-packing heuristic), just no longer
    overrides priority or ID sequence.

    A separate, HARD rule sits on top of cell CHOICE (not ordering): a small-insert library
    (`insert_size_bp` <= `insert_size_reuse_threshold`) is only ever placed as a cell's first
    use - PacBio flags <5 kb amplicons as losing yield on a 2nd/3rd use (see
    docs/pacbio-sprq-nx-scheduling-reference.md). Such a sample can still open a fresh cell,
    but never reuses one; if the day fills up it's reported unplaced rather than forced onto a
    reuse."""
    cap = max_uses if available_days is None else min(max_uses, available_days)

    # "By Order": schedule strictly in the sequence samples were uploaded and, within each
    # upload, the order their rows appeared in the CSV. For cell CHOICE it behaves exactly like
    # "utilisation" (fill a whole tray of fresh cells before reusing any), so the grid fills
    # day-by-day in that same order instead of deepening one cell across days; only the SAMPLE
    # ordering below differs. `cell_objective` is what the reuse tie-break / withholding read.
    by_order = objective == "order"
    cell_objective = "utilisation" if by_order else objective

    deg: dict[str, int] = {s.key: 0 for s in samples}
    for i in range(len(samples)):
        for j in range(i + 1, len(samples)):
            if not disjoint(set(samples[i].barcodes), samples[j].barcodes):
                deg[samples[i].key] += 1
                deg[samples[j].key] += 1

    if by_order:
        # Ascending DB primary key IS "upload order, then CSV row order within each upload":
        # import_service inserts a batch's rows in file order (each flushed as it's created, so
        # its id is assigned then) and a later import gets higher ids - so id order is exactly
        # "CSV A rows 1..n, then CSV B rows 1..n". Priority and the movie/Container-ID keys are
        # deliberately ignored - honouring the user's own sequence is the whole point of this
        # mode. sample_id is always set on the auto-fill path (real DB rows); the `is None`
        # guard only orders in-memory samples (e.g. a preview) deterministically and last.
        ordered = sorted(samples, key=lambda s: (s.sample_id is None, s.sample_id or 0))
    else:
        ordered = sorted(
            samples,
            key=lambda s: (
                priority_rank(s.priority),
                _movie_constraint_rank(s.movie_time),
                external_id_sort_key(s.id),
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
                pinned_well=pc.pinned_well,
                barcode_owners={b: set(exts) for b, exts in pc.barcode_owners.items()},
                tray_id=pc.tray_id,
            )
        )

    conflict_pairs: list[ConflictPair] = []
    for i in range(len(samples)):
        for j in range(i + 1, len(samples)):
            shared = [b for b in samples[i].barcodes if b in samples[j].barcodes]
            if shared:
                conflict_pairs.append(ConflictPair(a=samples[i].id, b=samples[j].id, shared=shared))

    utilisation_width = cells_per_day or len(WELLS)

    def _prior_allowance(c: PackedCell) -> int:
        # How many NEW uses this batch may add to a prior (reuse) cell. Bounded by the
        # dial (`max_uses`) exactly like a fresh cell, not just by the cell's physical
        # remaining capacity: with e.g. a 1x dial a leftover open sibling (remaining 3)
        # must be reused at most once this batch, never stacked to 3 - otherwise the
        # "Max uses per cell" dial silently wouldn't apply to reuse candidates at all,
        # and auto_fill's post-run disposal (which closes a cell out once it reaches the
        # dial) would have nothing coherent to cap against. Also capped by available_days
        # for the same reason fresh cells are (a cell runs at most once per calendar day).
        allowance = min(c.remaining, max(0, max_uses - c.uses_consumed))
        return allowance if available_days is None else min(allowance, available_days)

    unplaced: list[ParsedSample] = []
    for s in ordered:
        s_positions = movie_allowed_positions(s.movie_time)
        # Small-insert (<5 kb) libraries lose yield on a cell's 2nd/3rd use, so they may only
        # land on a first use (see the docstring / docs/pacbio-sprq-nx-scheduling-reference.md).
        s_small = s.insert_size_bp is not None and s.insert_size_bp <= insert_size_reuse_threshold
        cands = [
            c
            for c in cells
            if (len(c.uses) < _prior_allowance(c) if c.prior else len(c.uses) < cap)
            and not _foreign_clash(c, s)
            # Auto Schedule's movie-time cell rule: this sample can only share a cell whose
            # remaining allowed positions overlap its own (e.g. a 12h sample never lands on a
            # cell pinned to - or already holding a use pinned to - anything but cell 1). For
            # all-24h backlogs both sides are the full position set, so this never bites.
            and (cell_allowed_positions(c) & s_positions)
            # Small-insert samples only ever take a cell's FIRST use. When none is open they
            # fall through to opening a fresh cell below (still a first use) - never a reuse.
            and (not s_small or _cell_is_first_use(c))
        ]
        if cell_objective == "utilisation" and sum(1 for c in cells if not c.prior) < utilisation_width:
            # Not enough distinct fresh cells open yet to fill a whole instrument-day -
            # refuse to deepen an existing fresh cell and fall through to opening another
            # one instead. Prior (reuse) cells are unaffected: reuse-before-new-cell still
            # wins regardless of objective (see docs/pacbio-sprq-nx-scheduling-reference.md #5).
            cands = [c for c in cands if c.prior]
        cands.sort(
            key=lambda c: (
                0 if c.prior else 1,
                len(c.uses) if cell_objective in ("fastest", "utilisation") else -len(c.uses),
            )
        )

        if cands:
            c = cands[0]
            c.uses.append(s)
            c.barcodes.update(s.barcodes)
            for b in s.barcodes:
                c.barcode_owners.setdefault(b, set()).add(s.id)
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
                barcode_owners={b: {s.id} for b in s.barcodes},
            )
        )

    for c in cells:
        c.future_uses = len(c.uses)
        c.total_uses = (c.uses_consumed or 0) + c.future_uses
        c.cost_tier = min(3, max(1, c.total_uses))
        c.window_h = 0.0
        # This cell's own ceiling for the batch - cap for a fresh cell, _prior_allowance()
        # for a reuse candidate (same formula the packing loop above already gated
        # `cands` on, safe to recompute here since neither depends on len(c.uses)). Reached
        # means pack_cells stopped giving it work on purpose (the dial/available_days), not
        # because compatible samples ran out - see PackedCell.batch_capacity_reached.
        ceiling = cap if not c.prior else _prior_allowance(c)
        c.batch_capacity_reached = c.future_uses >= ceiling

    return PackResult(
        cells=[c for c in cells if c.future_uses > 0],
        all_cells=cells,
        unplaced=unplaced,
        conflict_pairs=conflict_pairs,
    )
