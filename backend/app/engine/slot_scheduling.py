"""Slot-scoped auto-scheduling for the interactive weekly grid.

Pure and DB-free (mirrors the packing/scheduling modules). Unlike ``schedule_cells``
- which lays out a fresh multi-day tray timeline from scratch - ``fill_slots`` places
already-packed cells onto a fixed set of user-selected, currently-empty grid cells
(each an (instrument, day) run with up to 8 free wells, two trays of 4 - or just the
first 4, tray 1 only, when the caller's `cells_per_day` caps a run to one tray). It
never reasons about partial well-occupancy: a slot is either fully available (up to
the well cap) or excluded by the caller.
"""
from __future__ import annotations

import math
from datetime import timedelta

from app.engine.constants import (
    ALL_CELL_POSITIONS,
    CELL_LIFETIME_H,
    CELL_MAX_USES,
    CELLS_PER_TRAY,
    DEFAULT_MOVIE_HOURS,
    LOCK_BUFFER_HOURS,
    WELLS,
    within_tray_pos,
)
from app.engine.packing import cell_allowed_positions
from app.engine.types import (
    PackedCell,
    SlotAssignment,
    SlotFillResult,
    SlotInput,
    WindowFlag,
)


def fill_slots(
    cells: list[PackedCell],
    slots: list[SlotInput],
    cells_per_day: int = len(WELLS),
) -> SlotFillResult:
    # Deterministic order: earliest date first, then instrument serial.
    slots_sorted = sorted(slots, key=lambda s: (s.run_date, s.instrument_serial))
    # Prior cells first, then most-used first (same as schedule_cells). Layered on top: a cell
    # whose movie-time rule confines it to specific wells (a 12h/30h cell - see
    # cell_allowed_positions) sorts before an unrestricted 24h cell within the same group, so
    # it claims its one required well before a 24h cell can take it (the "restriction only"
    # rule - 24h may use cells 1/4, but only when a 12h/30h sample doesn't need them). All-24h
    # backlogs are unaffected: every cell is unrestricted, so this middle key is constant and
    # the order collapses back to prior-first, most-used-first.
    ordered_cells = sorted(
        cells,
        key=lambda c: (
            0 if c.prior else 1,
            0 if cell_allowed_positions(c) != ALL_CELL_POSITIONS else 1,
            -c.future_uses,
        ),
    )

    # Free wells per slot, filled A01..D01 in order. `cells_per_day` restricts this to
    # tray 1 only (WELLS[:4]) when the user has capped auto-fill to one tray/day - see
    # docs/pacbio-sprq-nx-scheduling-reference.md's "Instrument load-lock timing" section.
    free_wells: dict[SlotInput, list[str]] = {s: list(WELLS[:cells_per_day]) for s in slots_sorted}

    # Per-cell placement progress: index of the next not-yet-placed use, plus the date
    # of its most recent placement (a physical cell can't run twice on the same day, or
    # out of chronological order - see the strictly-later-date check below).
    next_idx: dict[str, int] = {c.id: 0 for c in ordered_cells}
    last_placed_date: dict[str, object] = {c.id: None for c in ordered_cells}
    first_placed_date: dict[str, object] = {c.id: None for c in ordered_cells}

    # A well maps to one physical Cell for the rest of this batch once anyone - a prior
    # cell already resident there, or a freshly-opened cell claiming it for the first time
    # - takes it, *unless* that occupant has truly finished its whole physical lifetime
    # (see _well_is_vacated below): a different not-yet-real cell must never be handed a
    # well an earlier day's cell still has business with, even if that well shows "free"
    # on some particular day only because its current occupant simply isn't running that
    # day (blocked by the same-day/later-date rule, or just not yet reached in this day's
    # iteration). Without this, a well "vacated" only because its occupant is temporarily
    # not running silently gets handed to an unrelated PackedCell for the rest of the
    # week - which the persistence layer's per-box well cache then resolves back to the
    # SAME physical Cell as the first occupant (it only knows "well -> Cell" for an
    # already-opened box, not which logical packed cell is entitled to it), stacking more
    # than CELL_MAX_USES real uses onto one physical cell. Seeded up front with every cell
    # that already has a real, known physical position (prior cells loaded from the DB -
    # see engine_bridge.load_prior_cells); a freshly-opened cell registers itself here the
    # moment it first claims a well below.
    well_owner: dict[tuple[str, str], str] = {
        (cell.pinned_instrument_serial, cell.pinned_well): cell.id
        for cell in ordered_cells
        if cell.pinned_instrument_serial is not None and cell.pinned_well is not None
    }
    by_id: dict[str, PackedCell] = {c.id: c for c in ordered_cells}

    # Tray cohesion: one sample plate (a 4-well display box) is backed by a single physical SMRT
    # Cell tray - the lab owner's "one tray per plate load" rule (see docs/pacbio-sprq-nx-
    # scheduling-reference.md's "Plate vs cell"). (slot, display-box 0|1) -> the tray occupying
    # that box, so a cell reusing into a different plate box than its home box (a 1-plate run
    # offers only box 0) can never land two different trays in one plate. A prior cell keys by its
    # real CellTray.id; a fresh cell shares the "FRESH" sentinel (the persist layer groups a box's
    # fresh cells into one physical tray anyway).
    box_tray: dict[tuple[SlotInput, int], object] = {}

    def _tray_key(cell: PackedCell) -> object:
        if cell.prior:
            return cell.tray_id if cell.tray_id is not None else ("cell", cell.id)
        return "FRESH"

    def _box_ok(cell: PackedCell, slot: SlotInput, w: str) -> bool:
        """Tray-cohesion gate: `w`'s display box must be unclaimed, or already backed by this
        cell's own tray, so one sample plate never mixes two physical trays."""
        claimed = box_tray.get((slot, WELLS.index(w) // CELLS_PER_TRAY))
        return claimed is None or claimed == _tray_key(cell)

    def _well_is_vacated(owner_id: str) -> bool:
        """True once `owner_id` has truly reached the end of its physical life - every
        use pack_cells ever intends to give it this batch has been placed, *and* its
        lifetime total (existing consumed uses plus this batch's own) has hit the hard
        cap. Reloading a terminal well with a brand-new tray mid-batch is legitimate (see
        cell_service.open_new_tray's own "a box whose every cell has gone terminal is not
        a collision" rule) - but only once the current occupant is genuinely spent, never
        merely because it isn't running on one particular day. A cell pack_cells gave
        fewer than CELL_MAX_USES uses to (e.g. the backlog simply ran out of compatible
        samples for it) still owns its well indefinitely - it may get reused again in a
        *later*, separate Auto Schedule call, and that must land back in this same well."""
        owner = by_id.get(owner_id)
        if owner is None:
            return True
        return owner.total_uses >= CELL_MAX_USES and next_idx[owner_id] >= len(owner.uses)

    def _takeable(cell: PackedCell, slot: SlotInput, w: str, allowed: frozenset[int]) -> bool:
        """Can `cell` load into a *foreign* offered well `w` this slot (the fallback path, when
        the cell's own home well isn't available)? Three gates: the well must sit in a carousel
        position the cell's movie-time rule allows (`allowed`); it must not still belong to a
        *different*, not-yet-vacated cell (the over-use guard - see well_owner/_well_is_vacated);
        and its display box must pass cohesion (_box_ok). `owner == cell.id` lets a cell re-take
        its own well on a later day within this batch."""
        if within_tray_pos(w) not in allowed:
            return False
        owner = well_owner.get((slot.instrument_serial, w))
        if owner is not None and owner != cell.id and not _well_is_vacated(owner):
            return False
        return _box_ok(cell, slot, w)

    # Per instrument, the earliest run_date a brand-new run created by this batch may start, so a
    # slot before it is skipped and the plan never proposes a day the persistence layer would
    # reject. The authoritative lock (instrument_lock.run_lock_until, checked for real by
    # get_or_create_run) is now the per-cell "last cell finishes prep" time; here we only need DAY
    # granularity, so lock_hours below is a deliberately coarse day-level proxy (a <=4-well touch
    # clears within its own day -> gap 1; a >4-well touch spills to the next-but-one day -> gap 2).
    # It stays safe under the per-cell rule: a day is only ever rejected when a lock spans it in
    # full, which this proxy never under-counts for the common 24/30h movie case.
    instrument_open_from: dict[str, object] = {}

    assignments: list[SlotAssignment] = []
    touched: dict[SlotInput, SlotInput] = {}
    window_flags: list[WindowFlag] = []

    for slot in slots_sorted:
        open_from = instrument_open_from.get(slot.instrument_serial)
        if open_from is not None and slot.run_date < open_from:
            continue

        wells_used = 0
        slot_max_movie = 0  # longest movie placed in this slot - drives its lock window below
        for cell in ordered_cells:
            if not free_wells[slot]:
                break
            idx = next_idx[cell.id]
            if idx >= len(cell.uses):
                continue
            if cell.pinned_instrument_serial is not None and slot.instrument_serial != cell.pinned_instrument_serial:
                continue
            last_date = last_placed_date[cell.id]
            if last_date is not None and slot.run_date <= last_date:
                continue

            # A cell keeps its tray POSITION (the well's A/B/C/D letter) for life, but NOT its
            # plate box - it may reuse under either sample plate (see docs/pacbio-sprq-nx-
            # scheduling-reference.md's "Plate vs cell"). A prior cell prefers its own home well
            # when that's on offer (so 2-plate placement and tray cohesion stay byte-identical to
            # before), else falls back to any free same-position offered well - which is how a
            # Plate-2-box cell (home A02-D02) loads into a Plate-1 well when a 1-plate run offers
            # only A01-D01. A fresh cell (no pin yet) takes any allowed-position free well. Every
            # candidate must clear _takeable (movie-position rule, the well_owner over-use guard,
            # and the one-tray-per-plate cohesion guard).
            allowed = cell_allowed_positions(cell)
            home = cell.pinned_well
            # Prefer the cell's own home well: it's physically entitled to it, `free_wells`
            # already excludes any well actually taken this slot, so the only extra gates are the
            # movie-position rule and tray cohesion (NOT the well_owner over-use guard, which is
            # about taking a *foreign* well - the seed can map a shared home-well letter to a
            # different same-position cell). Else fall back to any takeable same-position free well.
            if home is not None and home in free_wells[slot] and within_tray_pos(home) in allowed and _box_ok(cell, slot, home):
                well = home
            else:
                well = next((w for w in free_wells[slot] if _takeable(cell, slot, w, allowed)), None)
            if well is None:
                continue
            free_wells[slot].remove(well)

            sample = cell.uses[idx]
            slot_max_movie = max(slot_max_movie, sample.movie_time or DEFAULT_MOVIE_HOURS)
            assignments.append(
                SlotAssignment(
                    cell=cell,
                    sample=sample,
                    well=well,
                    instrument_serial=slot.instrument_serial,
                    run_date=slot.run_date,
                )
            )
            touched[slot] = slot
            next_idx[cell.id] = idx + 1
            # A cell with no prior use is free to land its first use on any offered
            # instrument, but is then pinned there for the rest of this same batch -
            # otherwise its 2nd/3rd use could land on a different instrument later in
            # this same call, since pinned_instrument_serial otherwise only reflects
            # cells that already had a real DB use *before* this call (see
            # engine_bridge.load_prior_cells). Without this, a fresh cell's uses could
            # scatter across every offered instrument (see docs/pacbio-sprq-nx-scheduling-
            # reference.md's "a cell can never move between instruments" invariant).
            if cell.pinned_instrument_serial is None:
                cell.pinned_instrument_serial = slot.instrument_serial
            # Same reasoning, for well instead of instrument: a fresh cell's first use
            # pins it to whichever well it lands in, so its 2nd/3rd use within this same
            # batch is confined there too, not just prior cells loaded from the DB.
            if cell.pinned_well is None:
                cell.pinned_well = well
            # Register ownership at the ACTUAL loading well (not just the home-well seed above):
            # a prior cell that fell back to a foreign-box well must own THAT well, or a later
            # fresh cell could stack onto it (the over-use guard). Idempotent when a cell re-takes
            # its own well across days. Also claim this display box for the cell's tray so no other
            # tray can be loaded into the same sample plate (cohesion).
            well_owner[(slot.instrument_serial, well)] = cell.id
            box_tray[(slot, WELLS.index(well) // CELLS_PER_TRAY)] = _tray_key(cell)
            if first_placed_date[cell.id] is None:
                first_placed_date[cell.id] = slot.run_date
            last_placed_date[cell.id] = slot.run_date
            wells_used += 1

        if wells_used > 0:
            lock_hours = slot_max_movie + LOCK_BUFFER_HOURS if wells_used > len(WELLS) // 2 else LOCK_BUFFER_HOURS
            gap_days = math.ceil(lock_hours / 24)
            instrument_open_from[slot.instrument_serial] = slot.run_date + timedelta(days=gap_days)

    unplaced = [sample for cell in ordered_cells for sample in cell.uses[next_idx[cell.id] :]]

    for cell in ordered_cells:
        first = first_placed_date[cell.id]
        last = last_placed_date[cell.id]
        if first is not None and last is not None:
            # The 108h window is defined on when the later use *starts* (see
            # docs/pacbio-sprq-nx-scheduling-reference.md #2 and _reuse_window_open), so the
            # span is start-to-start - do NOT add run_time_hours (the last movie's length),
            # which would measure to the run's end and over-flag a use that legally starts
            # in-window but finishes after it.
            span = (last - first).days * 24
            if span > CELL_LIFETIME_H:
                window_flags.append(WindowFlag(cell=cell.id, span=span))

    return SlotFillResult(
        assignments=assignments,
        filled_slots=list(touched.values()),
        unplaced=unplaced,
        window_flags=window_flags,
    )
