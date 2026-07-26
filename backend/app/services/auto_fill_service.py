"""Auto-fill: the "auto schedule" assist. Given a user-selected set of empty grid cells,
packs the current backlog (reusing the prior-cell pool) and places as many samples as
fit onto those cells - re-running the exact same engine path (pack_cells + fill_slots)
server-side rather than trusting any client plan."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.engine.constants import CELL_LIFETIME_H, CELLS_PER_TRAY, DAY_START_HOUR, REUSE_PREP_H, WELLS
from app.engine.packing import pack_cells
from app.engine.slot_scheduling import fill_slots
from app.engine.types import ConflictPair, SlotInput
from app.models.audit import AuditLog
from app.models.cell import Cell
from app.models.instrument import Instrument
from app.models.sample import Sample
from app.models.schedule import CellUse, CellUseBarcode, Cycle, RunBatch
from app.services import instrument_lock
from app.services.cell_service import mark_cell_discarded, open_new_tray, recompute_status
from app.services.engine_bridge import load_backlog_samples, load_prior_cells, to_parsed_samples
from app.services.placement_service import PlacementError, get_or_create_run, planned_window
from app.timeutil import ensure_aware, utcnow


@dataclass
class AutoFillResult:
    placed_sample_ids: list[int] = field(default_factory=list)
    unplaced_sample_ids: list[int] = field(default_factory=list)
    skipped_cells: list[tuple[str, date]] = field(default_factory=list)
    window_flags: list[tuple[str, float]] = field(default_factory=list)
    barcode_conflicts: list[ConflictPair] = field(default_factory=list)
    run_ids: list[int] = field(default_factory=list)  # RunBatch (run) ids the batch created/touched
    disposed_cell_ids: list[int] = field(default_factory=list)  # cells auto-disposed after the run (dial cap / unused sibling)


def auto_fill(
    db: Session,
    *,
    cells,
    max_uses: int,
    run_time_hours: float,
    objective: str,
    cells_per_day: int = len(WELLS),
    start_hour: int = DAY_START_HOUR,
    start_minute: int = 0,
    actor: str | None = None,
):
    # --- validation ---
    for c in cells:
        if c.load_date.weekday() >= 5:
            raise PlacementError(400, f"{c.load_date.isoformat()} is a weekend - runs are weekdays only.")

    serials = {c.instrument_serial for c in cells}
    instruments = {
        i.serial_number: i
        for i in db.scalars(select(Instrument).where(Instrument.serial_number.in_(serials))).all()
    }
    for c in cells:
        if c.instrument_serial not in instruments:
            raise PlacementError(400, f"Unknown instrument serial '{c.instrument_serial}'.")

    # dedupe requested cells, then re-check each is still empty (and unlocked) at execution time
    requested: list[tuple[str, date]] = []
    seen: set[tuple[str, date]] = set()
    for c in cells:
        key = (c.instrument_serial, c.load_date)
        if key not in seen:
            seen.add(key)
            requested.append(key)

    empty_slots: list[SlotInput] = []
    skipped: list[tuple[str, date]] = []
    for serial, run_date in requested:
        inst = instruments[serial]
        # A maintenance-down instrument refuses new runs on/after its down date - skip the
        # slot (same "skip, don't hard-fail the batch" UX as an already-locked day below)
        # rather than letting get_or_create_run raise mid-loop. The grid already greys these
        # days so the user shouldn't be able to select them, but auto-fill re-validates
        # server-side rather than trusting the client selection.
        if inst.down_from is not None and run_date >= inst.down_from:
            skipped.append((serial, run_date))
            continue
        # Checked via CellUse, not just RunBatch's existence: a RunBatch/Cycle can survive
        # with zero stages (remove_sample's concurrent bulk-delete race, or the admin
        # table-clear tool - see get_or_create_run's docstring), and the grid already
        # treats that as an open, selectable cell (groupCyclesByInstrumentAndDay.isCellOpen).
        # Skipping on RunBatch existence alone silently dropped exactly the cells the UI
        # just told the user were empty. "cancelled" rows are excluded too, for the same
        # reason: a Stop-Cell-cascaded cancelled use is a permanent marker occupying one
        # well, not a real placement, and isCellOpen already treats a cancelled-only cycle
        # as open on the frontend - this must agree or Auto Schedule silently skips a cell
        # the grid just let the user select.
        occupied = db.scalar(
            select(CellUse.id)
            .join(CellUse.cycle)
            .join(Cycle.run_batch)
            .where(
                RunBatch.instrument_id == inst.id,
                RunBatch.load_date == run_date,
                CellUse.status != "cancelled",
            )
        )
        if occupied is not None:
            skipped.append((serial, run_date))
            continue
        proposed_start, _proposed_end = planned_window(run_date, run_time_hours, start_hour, start_minute)
        if instrument_lock.resolve_new_run_start(db, inst.id, run_date, proposed_start) is None:
            # Same rule as place_sample: only a lock spanning the *whole* load day blocks it
            # (a lock clearing on the day still leaves it loadable - get_or_create_run starts
            # the run when the instrument frees). Skip this slot rather than hard-failing the
            # whole batch, matching the existing "already occupied" skip UX.
            skipped.append((serial, run_date))
        else:
            empty_slots.append(SlotInput(instrument_serial=serial, run_date=run_date))

    # --- engine ---
    samples = load_backlog_samples(db)
    parsed = to_parsed_samples(samples)
    prior_cells, cells_by_id = load_prior_cells(db, [])
    # Cells cannot move between instruments: a prior cell pinned to an instrument that
    # isn't one of this call's actual empty slots can never be placed by fill_slots below
    # (see its pin filter) - exclude it from packing entirely, rather than letting it
    # "claim" a disjoint sample via barcode-compatibility only to strand that sample as
    # unplaced when a fresh cell on an offered instrument would have fit it instead.
    offered_serials = {s.instrument_serial for s in empty_slots}
    prior_cells = [
        pc for pc in prior_cells if pc.pinned_instrument_serial is None or pc.pinned_instrument_serial in offered_serials
    ]
    # A cell can only be reused once per calendar day (see fill_slots), so a reuse depth
    # deeper than the number of distinct days actually on offer can never be placed -
    # capping it here spreads samples across fresh cells instead of packing depth that
    # would just come back as unplaced.
    available_days = len({s.run_date for s in empty_slots})
    pack = pack_cells(
        parsed,
        max_uses=max_uses,
        objective=objective,
        prior_cells=prior_cells,
        available_days=available_days,
        cells_per_day=cells_per_day,
    )
    fill = fill_slots(pack.cells, empty_slots, run_time_hours, cells_per_day=cells_per_day)

    # PackedCell.id -> DB Cell (prior cells resolve to real rows; fresh cells created on first use)
    ref_to_cell: dict[str, Cell] = {pc.id: cells_by_id[pc.cell_id] for pc in pack.cells if pc.prior}

    # --- persist ---
    # Each acquisition DAY is its own load session -> its own run (RunBatch keyed
    # (instrument, load_date)), in BOTH plate modes. Plate 1 = tray-1 wells (A01-D01),
    # Plate 2 = tray-2 wells (A02-D02); a cell reused a LATER day forms a SEPARATE run that
    # day, carrying that cell on its next use (the Use 1/2/3 grid colour shows the reuse) -
    # never a second plate stacked onto the load day's run. This replaced an earlier
    # one-tray-only shape that paired a cell's use 1 + use 2 into a single TWO-plate run on
    # the load day: it rendered as "2 plates on Monday" even though only one physical tray is
    # ever loaded per day, contradicting a "1 plate per run" choice (reported by the lab
    # owner). Two-plate mode already worked this way; one-plate mode now matches it. See
    # docs/pacbio-sprq-nx-scheduling-reference.md's "Plate vs cell" / load-lock sections.
    plate_index_of: dict[int, int] = {
        id(a): (2 if a.well in WELLS[CELLS_PER_TRAY:] else 1) for a in fill.assignments
    }

    # Per-well planned start. A cell's first use in this batch starts at the run's load hour
    # (a fresh cell, or a prior cell whose earlier use already finished - the instrument is
    # free). A later reuse of the same cell chains off that use's real end + the on-board wash
    # (REUSE_PREP_H), so a long (24-30h) movie starts its next-day reuse in the afternoon/
    # evening rather than the flat load hour - never before the cells have physically finished
    # their previous acquisition. The chained start is used only while it still lands on the
    # very day the packer reserved for the reuse (which is weekday- and lock-aware); a chain
    # long enough to spill past that day (e.g. a 30h x 3-use cell) falls back to the load hour,
    # matching the packer's own day rather than silently floating the run to a later column.
    # (Previously this chaining lived in get_or_create_run's intra-run Plate 2 branch, which
    # only ran for the paired one-tray shape and never chained a 3rd use - see above.)
    assign_start: dict[int, datetime] = {}
    uses_by_cell_ref: dict[str, list] = defaultdict(list)
    for a in fill.assignments:
        uses_by_cell_ref[a.cell.id].append(a)
    for uses in uses_by_cell_ref.values():
        uses.sort(key=lambda x: x.run_date)
        prev_end: datetime | None = None
        for a in uses:
            base_start, _ = planned_window(a.run_date, run_time_hours, start_hour, start_minute)
            start = base_start
            if prev_end is not None:
                chained = prev_end + timedelta(hours=REUSE_PREP_H)
                if base_start <= chained and chained.date() == a.run_date:
                    start = chained
            assign_start[id(a)] = start
            prev_end = start + timedelta(hours=run_time_hours)

    # A cycle (one plate of one day's run) starts at the latest start among its wells - all
    # equal in practice (a day's wells are one reuse-generation), but the max keeps a mixed
    # fresh+reuse day (not produced by the current packer, but cheap to guard) from ever
    # starting a reused well before its cells are physically free.
    cycle_start: dict[tuple[str, date, int], datetime] = {}
    for a in fill.assignments:
        key = (a.instrument_serial, a.run_date, plate_index_of[id(a)])
        s = assign_start[id(a)]
        if key not in cycle_start or s > cycle_start[key]:
            cycle_start[key] = s

    run_plate_cycles: dict[tuple[str, date, int], int] = {}  # (instrument, load_date, plate) -> cycle id
    run_ids: set[int] = set()
    skipped_keys: set[tuple[str, date]] = set()  # (instrument, load_date) runs whose creation was locked out
    touched_cells: set[Cell] = set()
    placed_sample_ids: list[int] = []
    # fill_slots plans every slot as 8 fully-free wells (SlotInput's own documented
    # invariant) - true for a brand-new run, but no longer true once the occupied-check
    # above started letting a cancelled-only cycle through (its one cancelled CellUse
    # still occupies its well, permanently). Track which wells are actually taken per
    # cycle, seeded from the DB the first time each cycle_id is touched, and reassign a
    # colliding assignment to the next free well instead of letting the unique
    # (cycle_id, well) constraint raise mid-batch.
    occupied_wells: dict[int, set[str]] = {}
    # (instrument_id, box_start) -> {home_well: Cell} for every physical tray-of-4 this
    # batch has opened so far, keyed the same way open_new_tray() derives a box from a
    # well (see below). Several fresh cells can land in different wells of the *same*
    # box within one auto-fill call (e.g. filling all 4 first-use wells of "tray 1" at
    # once) - without this cache each would independently open its own brand-new
    # CellTray, producing 4 physical trays (and non-sequential cell ids) for what's
    # really one tray box being loaded.
    opened_boxes: dict[tuple[int, int], dict[str, Cell]] = {}
    # (instrument_id, well) -> the PackedCell.id currently resolved to that exact well -
    # tracked per well, not per box, since several *different* fresh PackedCells
    # legitimately share one box at once (one per well - see opened_boxes above). Lets
    # the loop below tell "the same logical cell, resolved again" apart from "a
    # *different* PackedCell now needs this exact well because the engine already proved
    # its previous occupant genuinely exhausted its full physical lifetime" (see
    # slot_scheduling.py's well_owner/_well_is_vacated - fill_slots only ever hands an
    # already-claimed well to a new PackedCell once that's true, e.g. a fresh cell hits
    # its 3-use cap by midweek and a brand-new tray is planned into the same well
    # position later in the same batch).
    well_claimant: dict[tuple[int, str], str] = {}
    now = utcnow()

    def _resolve_well(cycle_id: int, requested_well: str) -> str | None:
        taken = occupied_wells.get(cycle_id)
        if taken is None:
            taken = {row[0] for row in db.execute(select(CellUse.well).where(CellUse.cycle_id == cycle_id)).all()}
            occupied_wells[cycle_id] = taken
        if requested_well not in taken:
            return requested_well
        # Only search within the wells this batch is actually allowed to use - falling
        # back past cells_per_day would silently load a second tray on a day the user
        # capped to one.
        return next((w for w in WELLS[:cells_per_day] if w not in taken), None)

    # Process in chronological order per instrument (not pack/cell order) rather than
    # fill.assignments' own order. A full-tray run's lock can span into the next calendar
    # day (see instrument_lock.cycle_lock_until), and that "tray 2 loaded" state is read
    # back from the CellUse rows just persisted for the earlier day - so the earlier day's
    # cell uses must already be committed before the later day's run is created, or the
    # lock goes undetected. The pre-scan above can't foresee a lock this batch is about to
    # create for itself; if that surfaces here as a PlacementError, skip just this day
    # (same as an already-locked day is skipped above) instead of letting it raise mid-loop
    # and roll back every other day already placed.
    for a in sorted(fill.assignments, key=lambda a: (a.instrument_serial, a.run_date)):
        load_date = a.run_date  # each acquisition day is its own run/load session (see above)
        plate_index = plate_index_of[id(a)]
        run_key = (a.instrument_serial, load_date)
        if run_key in skipped_keys:
            continue
        plate_key = (a.instrument_serial, load_date, plate_index)
        cycle_id = run_plate_cycles.get(plate_key)
        if cycle_id is None:
            cyc_start = cycle_start[plate_key]
            try:
                cyc = get_or_create_run(
                    db,
                    instrument=instruments[a.instrument_serial],
                    load_date=load_date,
                    plate_index=plate_index,
                    # Reuse is now a separate later-day run (load_date == acquire_date), so the
                    # intra-run reuse_plate_window branch never fires here; the reuse's chained
                    # start is carried explicitly via cyc_start (computed above).
                    acquire_date=load_date,
                    run_time_hours=run_time_hours,
                    start_hour=cyc_start.hour,
                    start_minute=cyc_start.minute,
                )
            except PlacementError:
                skipped_keys.add(run_key)
                skipped.append(run_key)
                continue
            cycle_id = cyc.id
            run_plate_cycles[plate_key] = cycle_id
            run_ids.add(cyc.run_batch_id)

        well = _resolve_well(cycle_id, a.well)
        if well is None:
            # Every well in this cycle is already spoken for (a pre-existing marker plus
            # this batch's own earlier assignments) - this sample can't land here after
            # all; leave it unplaced rather than crash on a well collision.
            continue
        if well != a.well and a.cell.prior:
            # a.cell is a real, already-persisted Cell that fill_slots confined to
            # exactly a.well (its actual pinned well) - reassigning it here would
            # silently relocate a physical cell that can't actually move. Only a
            # pre-existing marker (e.g. a cancelled-only leftover) could ever collide
            # with a real pin in the first place; drop this placement rather than
            # violate the "same cell, same well, for life" invariant. A *fresh* cell
            # (not yet a real row) has no such physical commitment yet, so it's still
            # safe to let the reassignment below land it on a different free well.
            continue

        db_cell = ref_to_cell.get(a.cell.id)
        if db_cell is None:
            instrument_id = instruments[a.instrument_serial].id
            box_start = (WELLS.index(well) // CELLS_PER_TRAY) * CELLS_PER_TRAY
            box_key = (instrument_id, box_start)
            box_cells = opened_boxes.get(box_key)
            if box_cells is not None and well_claimant.get((instrument_id, well)) not in (None, a.cell.id):
                # A *different* PackedCell now needs this exact well - the engine already
                # proved every cell in this box has genuinely reached the end of its
                # physical life before handing the well to a new logical cell (see
                # slot_scheduling.py's _well_is_vacated), so it's legitimate to retire the
                # old physical tray and load a brand-new one in its place, even within
                # this same batch. Recompute the old cells' status right now (rather than
                # waiting for this function's own end-of-loop pass below) so
                # open_new_tray()'s own "is this box still live" collision guard sees them
                # as already exhausted, not stale "open" rows - if some sibling in this
                # box *hasn't* actually finished (a real, uneven-quota edge case), that
                # guard correctly refuses the reopen and this sample is left unplaced
                # rather than corrupting anything. Every well in the box is cleared, not
                # just this one, so its other siblings (already resolved earlier under
                # the old generation) don't each independently re-trigger this same
                # retirement once their own next assignment comes through.
                for old_cell in box_cells.values():
                    db.refresh(old_cell, attribute_names=["cell_uses"])
                    recompute_status(old_cell, now)
                # This session runs with autoflush=False (db.py) - without an explicit
                # flush here, the status changes above stay pending Python-side and
                # open_new_tray()'s own raw `Cell.status == "open"` collision query
                # below wouldn't see them yet, so it would wrongly still find these
                # cells "open" and refuse the legitimate reopen.
                db.flush()
                for w in WELLS[box_start : box_start + CELLS_PER_TRAY]:
                    well_claimant.pop((instrument_id, w), None)
                box_cells = None
                opened_boxes.pop(box_key, None)
            if box_cells is None:
                # Opens a whole new physical tray (4 cells), not just this one - the
                # other 3 are left open/unused and surface as preferred reuse candidates
                # on the next placement/auto-fill call (see open_new_tray()). load_prior_cells
                # should already have offered any pre-existing box's siblings as prior
                # candidates, so open_new_tray() raising here (its box-collision guard)
                # would mean the pre-batch snapshot missed a box opened earlier in this
                # same loop under a different key, or drifted from the DB some other way -
                # leave this one sample unplaced rather than roll back the whole batch.
                try:
                    box_cells = {c.home_well: c for c in open_new_tray(db, instrument_id, well)}
                except ValueError:
                    continue
                opened_boxes[box_key] = box_cells
            well_claimant[(instrument_id, well)] = a.cell.id
            db_cell = box_cells[well]
            ref_to_cell[a.cell.id] = db_cell

        cell_use = CellUse(
            cycle_id=cycle_id,
            cell_id=db_cell.id,
            sample_id=a.sample.sample_id,
            well=well,
            # Every well an auto-fill batch places shares the one Run Design dial value, so a
            # run's representative movie_hours (set at get_or_create_run) already equals this
            # - no per-cycle recompute needed. Editing a single cell's run time afterward
            # (slot-detail popover) is what makes a run's wells diverge later.
            run_time_hours=int(run_time_hours),
            status="planned",
        )
        db.add(cell_use)
        db.flush()
        occupied_wells[cycle_id].add(well)
        for bc in a.sample.barcodes:
            db.add(CellUseBarcode(cell_use_id=cell_use.id, barcode=bc))
        touched_cells.add(db_cell)
        if a.sample.sample_id is not None:
            placed_sample_ids.append(a.sample.sample_id)

    if placed_sample_ids:
        db.execute(update(Sample).where(Sample.id.in_(placed_sample_ids)).values(status="scheduled"))

    for db_cell in touched_cells:
        db.refresh(db_cell, attribute_names=["cell_uses"])
        recompute_status(db_cell, now)

    # --- auto-dispose: the "Max uses per cell" dial enforces a per-cell TOTAL-use cap, but
    #     a SMRT-cell tray of 4 is one physical object - it loads into, and is removed from,
    #     a single instrument carousel position as a unit, and disposal is all-or-nothing
    #     across the whole tray, never per cell (see docs/pacbio-sprq-nx-scheduling-
    #     reference.md's "Tray-of-4" invariant). So disposal is tray-scoped: a tray is binned
    #     - every one of its cells marked terminal together, via mark_cell_discarded (the
    #     *bare* variant, which sets the sticky exhausted/discarded state WITHOUT cancelling
    #     the uses this batch just scheduled) - only once EVERY cell in it has been used to
    #     the dial (the tray is fully spent to the chosen depth). A tray still holding an
    #     unused or below-dial cell stays on the instrument, all cells "open", for a later
    #     run to finish and then dispose as a unit - never a half-binned tray.
    candidate_tray_ids: set[int] = {c.tray_id for c in touched_cells if c.tray_id is not None}
    for box_cells in opened_boxes.values():
        candidate_tray_ids.update(c.tray_id for c in box_cells.values() if c.tray_id is not None)

    def _active_uses(cell: Cell) -> int:
        return len([cu for cu in cell.cell_uses if cu.status != "cancelled"])

    disposed_cell_ids: list[int] = []
    for tray_id in candidate_tray_ids:
        tray_cells = db.scalars(select(Cell).where(Cell.tray_id == tray_id)).all()
        for cell in tray_cells:
            db.refresh(cell, attribute_names=["cell_uses"])
        # A stopped/retired cell means the tray needs manual attention - never auto-bin it.
        if any(cell.status in ("retired", "stopped") for cell in tray_cells):
            continue
        # Not fully spent yet (some cell hasn't reached the dial) - leave the whole tray open.
        if not all(_active_uses(cell) >= max_uses for cell in tray_cells):
            continue
        # Every cell reached the dial: bin the tray as one unit. Cells already terminal by
        # natural exhaustion (dial == 3) carry no leftover capacity and need no flag or count;
        # only cells still "open" (used to the dial with physical capacity to spare, dial < 3)
        # are the ones actually being disposed early, so those are what we mark and report.
        for cell in tray_cells:
            if cell.status != "open" or cell.discarded_at is not None:
                continue
            mark_cell_discarded(cell, f"Auto schedule: tray fully used to max {max_uses}", now)
            disposed_cell_ids.append(cell.id)
    if disposed_cell_ids:
        db.flush()

    # --- window flags: planned-only spans from the engine, plus a real-anchor check for
    #     prior cells whose true elapsed lifetime (from first_use_started_at) is at risk ---
    flag_span: dict[str, float] = {}

    def _bump(code: str, span: float) -> None:
        if code not in flag_span or span > flag_span[code]:
            flag_span[code] = span

    for wf in fill.window_flags:
        db_cell = ref_to_cell.get(wf.cell)
        _bump(db_cell.code if db_cell else wf.cell, wf.span)

    last_date_by_ref: dict[str, date] = {}
    for a in fill.assignments:
        if (a.instrument_serial, a.run_date) in skipped_keys:  # each run's load day is its acquire day now
            continue
        cur = last_date_by_ref.get(a.cell.id)
        if cur is None or a.run_date > cur:
            last_date_by_ref[a.cell.id] = a.run_date

    for pc in pack.cells:
        if not pc.prior or pc.id not in last_date_by_ref:
            continue
        db_cell = ref_to_cell[pc.id]
        started = db_cell.first_use_started_at
        if started is None:
            continue
        # Measure to the last use's *start*, not its end: the 108h window is defined on when
        # the later use starts (see docs/pacbio-sprq-nx-scheduling-reference.md #2 and
        # _reuse_window_open), so planned_window()[0] (start), not [1] (end).
        planned_start = planned_window(last_date_by_ref[pc.id], run_time_hours, start_hour, start_minute)[0]
        span_h = (planned_start - ensure_aware(started)).total_seconds() / 3600
        if span_h > CELL_LIFETIME_H:
            _bump(db_cell.code, span_h)

    placed_set = set(placed_sample_ids)
    unplaced_sample_ids = [s.id for s in samples if s.id not in placed_set]

    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="auto_fill",
            entity_type="cycle",
            entity_id=None,
            details_json={
                "placed": len(placed_sample_ids),
                "unplaced": len(unplaced_sample_ids),
                "skipped": len(skipped),
                "runs": len(run_ids),
                "disposed": len(disposed_cell_ids),
            },
        )
    )
    db.commit()

    return AutoFillResult(
        placed_sample_ids=placed_sample_ids,
        unplaced_sample_ids=unplaced_sample_ids,
        skipped_cells=skipped,
        window_flags=[(code, span) for code, span in flag_span.items()],
        barcode_conflicts=pack.conflict_pairs,
        run_ids=list(run_ids),
        disposed_cell_ids=disposed_cell_ids,
    )
