"""Slot-scoped auto-scheduling for the interactive weekly grid.

Pure and DB-free (mirrors the packing/scheduling modules). Unlike ``schedule_cells``
- which lays out a fresh multi-day tray timeline from scratch - ``fill_slots`` places
already-packed cells onto a fixed set of user-selected, currently-empty grid cells
(each an (instrument, day) run with 8 free wells, two trays of 4). It never reasons
about partial well-occupancy: a slot is either fully available or excluded by the
caller.
"""
from __future__ import annotations

import math
from datetime import timedelta

from app.engine.constants import CELL_LIFETIME_H, LOCK_BUFFER_HOURS, WELLS
from app.engine.types import (
    PackedCell,
    SlotAssignment,
    SlotFillResult,
    SlotInput,
    WindowFlag,
)


def fill_slots(cells: list[PackedCell], slots: list[SlotInput], run_time_hours: float) -> SlotFillResult:
    # Deterministic order: earliest date first, then instrument serial.
    slots_sorted = sorted(slots, key=lambda s: (s.run_date, s.instrument_serial))
    # Same cell ordering as schedule_cells: prior cells first, then most-used first.
    ordered_cells = sorted(cells, key=lambda c: (0 if c.prior else 1, -c.future_uses))

    # Free wells per slot, filled A01..D01 in order.
    free_wells: dict[SlotInput, list[str]] = {s: list(WELLS) for s in slots_sorted}

    # Per-cell placement progress: index of the next not-yet-placed use, plus the date
    # of its most recent placement (a physical cell can't run twice on the same day, or
    # out of chronological order - see the strictly-later-date check below).
    next_idx: dict[str, int] = {c.id: 0 for c in ordered_cells}
    last_placed_date: dict[str, object] = {c.id: None for c in ordered_cells}
    first_placed_date: dict[str, object] = {c.id: None for c in ordered_cells}

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

            sample = cell.uses[idx]
            well = free_wells[slot].pop(0)
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
