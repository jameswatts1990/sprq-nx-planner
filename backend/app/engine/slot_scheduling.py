"""Slot-scoped auto-scheduling for the interactive weekly grid.

Pure and DB-free (mirrors the packing/scheduling modules). Unlike ``schedule_cells``
- which lays out a fresh multi-day tray timeline from scratch - ``fill_slots`` places
already-packed cells onto a fixed set of user-selected, currently-empty grid cells
(each an (instrument, day) run with 8 free wells, two trays of 4). It never reasons
about partial well-occupancy: a slot is either fully available or excluded by the
caller.
"""
from __future__ import annotations

from app.engine.constants import CELL_LIFETIME_H, WELLS
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

    assignments: list[SlotAssignment] = []
    touched: dict[SlotInput, SlotInput] = {}
    unplaced = []
    window_flags: list[WindowFlag] = []

    for cell in ordered_cells:
        last_placed_date = None
        first_placed_date = None
        for sample in cell.uses:
            chosen: SlotInput | None = None
            for slot in slots_sorted:
                if not free_wells[slot]:
                    continue
                # A physical cell can't run twice on the same day (or out of chronological
                # order): require strictly-later date.
                if last_placed_date is not None and slot.run_date <= last_placed_date:
                    continue
                # Cells cannot move between instruments: once pinned to one (because it
                # already has a real use there), only slots on that same instrument are
                # eligible - it falls to unplaced otherwise, same as any other skip below.
                if cell.pinned_instrument_serial is not None and slot.instrument_serial != cell.pinned_instrument_serial:
                    continue
                chosen = slot
                break

            if chosen is None:
                unplaced.append(sample)
                continue

            well = free_wells[chosen].pop(0)
            assignments.append(
                SlotAssignment(
                    cell=cell,
                    sample=sample,
                    well=well,
                    instrument_serial=chosen.instrument_serial,
                    run_date=chosen.run_date,
                )
            )
            touched[chosen] = chosen
            if first_placed_date is None:
                first_placed_date = chosen.run_date
            last_placed_date = chosen.run_date

        # Planned-only window span for a placed cell, mirroring schedule_cells' style.
        if first_placed_date is not None and last_placed_date is not None:
            span = (last_placed_date - first_placed_date).days * 24 + run_time_hours
            if span > CELL_LIFETIME_H:
                window_flags.append(WindowFlag(cell=cell.id, span=span))

    return SlotFillResult(
        assignments=assignments,
        filled_slots=list(touched.values()),
        unplaced=unplaced,
        window_flags=window_flags,
    )
