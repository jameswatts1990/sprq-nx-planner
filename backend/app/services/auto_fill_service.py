"""Auto-fill: the "auto schedule" assist. Given a user-selected set of empty grid cells,
packs the current backlog (reusing the prior-cell pool) and places as many samples as
fit onto those cells - re-running the exact same engine path (pack_cells + fill_slots)
server-side rather than trusting any client plan."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.engine.constants import CELL_LIFETIME_H, CELL_MAX_USES, DAY_START_HOUR, WELLS
from app.engine.packing import pack_cells
from app.engine.slot_scheduling import fill_slots
from app.engine.types import ConflictPair, SlotInput
from app.models.audit import AuditLog
from app.models.cell import Cell
from app.models.instrument import Instrument
from app.models.sample import Sample
from app.models.schedule import CellUse, CellUseBarcode, Cycle, RunBatch
from app.services import instrument_lock
from app.services.cell_service import recompute_status
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
    run_cycle_ids: list[int] = field(default_factory=list)


def auto_fill(
    db: Session,
    *,
    cells,
    max_uses: int,
    run_time_hours: float,
    objective: str,
    start_hour: int = DAY_START_HOUR,
    start_minute: int = 0,
    actor: str | None = None,
):
    # --- validation ---
    for c in cells:
        if c.run_date.weekday() >= 5:
            raise PlacementError(400, f"{c.run_date.isoformat()} is a weekend - runs are weekdays only.")

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
        key = (c.instrument_serial, c.run_date)
        if key not in seen:
            seen.add(key)
            requested.append(key)

    empty_slots: list[SlotInput] = []
    skipped: list[tuple[str, date]] = []
    for serial, run_date in requested:
        inst = instruments[serial]
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
                RunBatch.run_date == run_date,
                CellUse.status != "cancelled",
            )
        )
        if occupied is not None:
            skipped.append((serial, run_date))
            continue
        proposed_start, _proposed_end = planned_window(run_date, run_time_hours, start_hour, start_minute)
        blocking = instrument_lock.latest_lock_until(db, inst.id, run_date)
        if blocking is not None and proposed_start < blocking:
            # Same "new run's start time can't beat a prior lock" rule as place_sample -
            # skip this slot rather than hard-failing the whole batch, matching the
            # existing "already occupied" skip UX.
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
        parsed, max_uses=max_uses, objective=objective, prior_cells=prior_cells, available_days=available_days
    )
    fill = fill_slots(pack.cells, empty_slots, run_time_hours)

    # PackedCell.id -> DB Cell (prior cells resolve to real rows; fresh cells created on first use)
    ref_to_cell: dict[str, Cell] = {pc.id: cells_by_id[pc.cell_id] for pc in pack.cells if pc.prior}

    # --- persist ---
    run_cycles: dict[tuple[str, date], int] = {}
    skipped_keys: set[tuple[str, date]] = set()
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

    def _resolve_well(cycle_id: int, requested_well: str) -> str | None:
        taken = occupied_wells.get(cycle_id)
        if taken is None:
            taken = {row[0] for row in db.execute(select(CellUse.well).where(CellUse.cycle_id == cycle_id)).all()}
            occupied_wells[cycle_id] = taken
        if requested_well not in taken:
            return requested_well
        return next((w for w in WELLS if w not in taken), None)

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
        key = (a.instrument_serial, a.run_date)
        if key in skipped_keys:
            continue
        cycle_id = run_cycles.get(key)
        if cycle_id is None:
            try:
                cyc = get_or_create_run(
                    db,
                    instrument=instruments[a.instrument_serial],
                    run_date=a.run_date,
                    run_time_hours=run_time_hours,
                    start_hour=start_hour,
                    start_minute=start_minute,
                )
            except PlacementError:
                skipped_keys.add(key)
                skipped.append(key)
                continue
            cycle_id = cyc.id
            run_cycles[key] = cycle_id

        well = _resolve_well(cycle_id, a.well)
        if well is None:
            # Every well in this cycle is already spoken for (a pre-existing marker plus
            # this batch's own earlier assignments) - this sample can't land here after
            # all; leave it unplaced rather than crash on a well collision.
            continue

        db_cell = ref_to_cell.get(a.cell.id)
        if db_cell is None:
            db_cell = Cell(code="PENDING", max_uses=CELL_MAX_USES, status="open")
            db.add(db_cell)
            db.flush()
            db_cell.code = f"CELL-{db_cell.id:06d}"
            ref_to_cell[a.cell.id] = db_cell

        cell_use = CellUse(
            cycle_id=cycle_id,
            cell_id=db_cell.id,
            sample_id=a.sample.sample_id,
            well=well,
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

    now = utcnow()
    for db_cell in touched_cells:
        db.refresh(db_cell, attribute_names=["cell_uses"])
        recompute_status(db_cell, now)

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
        if (a.instrument_serial, a.run_date) in skipped_keys:
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
        planned_end = planned_window(last_date_by_ref[pc.id], run_time_hours, start_hour, start_minute)[1]
        span_h = (planned_end - ensure_aware(started)).total_seconds() / 3600
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
                "runs": len(run_cycles),
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
        run_cycle_ids=list(run_cycles.values()),
    )
