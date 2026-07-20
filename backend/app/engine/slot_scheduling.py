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

from app.engine.constants import CELL_LIFETIME_H, CELL_MAX_USES, LOCK_BUFFER_HOURS, WELLS
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
    run_time_hours: float,
    cells_per_day: int = len(WELLS),
) -> SlotFillResult:
    # Deterministic order: earliest date first, then instrument serial.
    slots_sorted = sorted(slots, key=lambda s: (s.run_date, s.instrument_serial))
    # Same cell ordering as schedule_cells: prior cells first, then most-used first.
    ordered_cells = sorted(cells, key=lambda c: (0 if c.prior else 1, -c.future_uses))

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

    # Loading more than half a slot's wells (i.e. tray 2) commits that instrument to the
    # full movie plus a settle buffer before it can start its next run - long enough to
    # spill into the immediately following calendar day(s) (mirrors
    # instrument_lock.cycle_lock_until, which persistence checks for real via
    # get_or_create_run). A half-tray (<=4 well) run only locks for the short settle
    # buffer and never blocks the next day. This tracks, per instrument, the earliest
    # run_date a brand-new run created by this batch may start; any slot before that
    # date is skipped entirely, so the plan this function produces never proposes a day
    # the persistence layer would go on to reject.
    instrument_open_from: dict[str, object] = {}

    assignments: list[SlotAssignment] = []
    touched: dict[SlotInput, SlotInput] = {}
    window_flags: list[WindowFlag] = []

    for slot in slots_sorted:
        open_from = instrument_open_from.get(slot.instrument_serial)
        if open_from is not None and slot.run_date < open_from:
            continue

        wells_used = 0
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

            # A cell is physically fixed to one well for its whole life (see
            # docs/pacbio-sprq-nx-scheduling-reference.md's "must stay in the same well"
            # invariant, already enforced for manual placement/move). A
            # pinned cell can only take *that* well here - if it isn't free this slot,
            # skip this cell for this slot rather than grabbing a different well, which
            # would silently relocate a physical cell that can't actually move.
            if cell.pinned_well is not None:
                if cell.pinned_well not in free_wells[slot]:
                    continue
                well = cell.pinned_well
                free_wells[slot].remove(well)
            else:
                # Skip any well this slot's free list still shows as unused but that some
                # *other*, not-yet-vacated cell already claimed earlier in this batch (see
                # well_owner/_well_is_vacated above) - only a well nobody has claimed yet,
                # or whose claimant has genuinely finished its physical lifetime, is truly
                # available to a brand-new cell.
                well = next(
                    (
                        w
                        for w in free_wells[slot]
                        if (owner := well_owner.get((slot.instrument_serial, w))) is None or _well_is_vacated(owner)
                    ),
                    None,
                )
                if well is None:
                    continue
                free_wells[slot].remove(well)

            sample = cell.uses[idx]
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
                well_owner[(slot.instrument_serial, well)] = cell.id
            if first_placed_date[cell.id] is None:
                first_placed_date[cell.id] = slot.run_date
            last_placed_date[cell.id] = slot.run_date
            wells_used += 1

        if wells_used > 0:
            lock_hours = run_time_hours + LOCK_BUFFER_HOURS if wells_used > len(WELLS) // 2 else LOCK_BUFFER_HOURS
            gap_days = math.ceil(lock_hours / 24)
            instrument_open_from[slot.instrument_serial] = slot.run_date + timedelta(days=gap_days)

    unplaced = [sample for cell in ordered_cells for sample in cell.uses[next_idx[cell.id] :]]

    for cell in ordered_cells:
        first = first_placed_date[cell.id]
        last = last_placed_date[cell.id]
        if first is not None and last is not None:
            span = (last - first).days * 24 + run_time_hours
            if span > CELL_LIFETIME_H:
                window_flags.append(WindowFlag(cell=cell.id, span=span))

    return SlotFillResult(
        assignments=assignments,
        filled_slots=list(touched.values()),
        unplaced=unplaced,
        window_flags=window_flags,
    )
