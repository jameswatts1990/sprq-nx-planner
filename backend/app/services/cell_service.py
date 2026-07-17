"""Cell derivation, serialization, and the two one-off cutover actions (bootstrap/retire).

The core rule lives in derive_cell_state(): a cell's live capacity and burned-barcode
set are always computed from its real cell_uses, never manually re-entered. This is
what replaces the prototype's free-text "in-progress cells" panel.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.engine.constants import CELL_LIFETIME_H, CELL_MAX_USES, CELLS_PER_TRAY, WELLS
from app.models.audit import AuditLog
from app.models.cell import Cell
from app.models.cell_tray import CellTray
from app.models.instrument import Instrument
from app.models.schedule import CellUse, CellUseBarcode, Cycle, RunBatch
from app.schemas.cell import CellBootstrapRequest, CellDetailOut, CellOut, CellUseHistoryOut
from app.timeutil import ensure_aware, utcnow


def recompute_status(cell: Cell, at: datetime | None = None) -> None:
    """The single place cell.status is derived - called any time a cell's uses change
    (committing new uses onto it, or recording a real-world outcome), so the persisted
    status never goes stale relative to derive_cell_state()."""
    if cell.status in ("retired", "stopped"):
        return
    at = at or utcnow()
    if cell.first_use_started_at:
        elapsed_h = (at - ensure_aware(cell.first_use_started_at)).total_seconds() / 3600
        if elapsed_h > CELL_LIFETIME_H:
            cell.window_breached = True

    _uses_consumed, remaining, _burned = derive_cell_state(cell)
    if remaining <= 0:
        cell.status = "exhausted"
    elif cell.window_breached:
        cell.status = "window_expired"
    else:
        cell.status = "open"


def derive_cell_state(cell: Cell) -> tuple[int, int, list[str]]:
    active_uses = [cu for cu in cell.cell_uses if cu.status != "cancelled"]
    uses_consumed = len(active_uses)
    remaining = max(0, cell.max_uses - uses_consumed)
    burned: list[str] = []
    seen: set[str] = set()
    for cu in active_uses:
        for b in cu.barcode_list:
            if b not in seen:
                seen.add(b)
                burned.append(b)
    return uses_consumed, remaining, burned


def use_run_date(cell_use: CellUse) -> date | None:
    """The calendar day a specific use is/was scheduled for, via its Cycle's RunBatch -
    the only correct way to order a cell's uses chronologically. CellUse.id (insertion
    order) is not a reliable stand-in: a batch auto-fill can commit multiple cells' rows
    in an order grouped by instrument rather than by any one cell's own date sequence
    (see auto_fill_service.py's persist loop), so "inserted later" does not imply
    "happened later" once a schedule spans more than one instrument."""
    run_batch = cell_use.cycle.run_batch if cell_use.cycle else None
    return run_batch.run_date if run_batch else None


def current_location(cell: Cell) -> tuple[str | None, str | None]:
    active_uses = [cu for cu in cell.cell_uses if cu.status != "cancelled"]
    if not active_uses:
        # No use yet - but a tray-linked cell is still a real physical object already
        # sitting on whichever instrument its tray was loaded onto (see open_new_tray()),
        # pinned to the well its tray reserved for it (home_well) even before its own
        # first use.
        if cell.tray is not None:
            return cell.tray.instrument.serial_number, cell.home_well
        return None, None
    last = max(active_uses, key=lambda cu: (use_run_date(cu) or date.min, cu.id))
    run_batch = last.cycle.run_batch if last.cycle else None
    instrument = run_batch.instrument if run_batch else None
    return (instrument.serial_number if instrument else None), last.well


def open_new_tray(db: Session, instrument_id: int, well: str) -> list[Cell]:
    """Open a brand-new physical SMRT Cell tray: creates one CellTray row plus all
    CELLS_PER_TRAY Cell rows at once (position 1..4, status "open", 0 uses), not just the
    one about to be used. The other 3 are real, reusable cells from this point on - they
    surface as preferred reuse candidates ahead of any other brand-new tray via
    load_prior_cells()/pack_cells() (see docs/pacbio-sprq-nx-scheduling-reference.md #5),
    with no engine changes needed since `Cell.status == "open"` is already the only
    filter load_prior_cells() applies.

    `well` is the well the sample is landing in right now (e.g. "C01") - it fixes which
    physical tray box (WELLS' own 4-well "tray 1"/"tray 2" split) this CellTray occupies,
    and each of the 4 cells is pinned to one well in that box (Cell.home_well/tray_position,
    in fixed A/B/C/D order) so an unused sibling can still surface a real current_well via
    current_location() and render in the weekly grid before it's ever used.

    Returns the 4 cells reordered so index 0 is always the cell whose home_well == well
    (the one being placed right now), followed by its 3 siblings in position order."""
    box_start = (WELLS.index(well) // CELLS_PER_TRAY) * CELLS_PER_TRAY
    box_wells = WELLS[box_start : box_start + CELLS_PER_TRAY]

    tray = CellTray(instrument_id=instrument_id)
    db.add(tray)
    db.flush()

    placed: Cell | None = None
    siblings: list[Cell] = []
    for position, home_well in enumerate(box_wells, start=1):
        cell = Cell(
            code="PENDING",
            max_uses=CELL_MAX_USES,
            status="open",
            tray_id=tray.id,
            tray_position=position,
            home_well=home_well,
        )
        db.add(cell)
        db.flush()
        tray_letter = chr(ord("A") + position - 1)
        cell.code = f"CELL-{tray_letter}{cell.id:06d}"
        if home_well == well:
            placed = cell
        else:
            siblings.append(cell)
    assert placed is not None, f"well {well!r} not found in its own tray box {box_wells!r}"
    return [placed, *siblings]


def cleanup_tray_if_fully_unused(db: Session, cell: Cell) -> None:
    """The tray-wide counterpart to open_new_tray(): once a placement's last use is removed
    (remove_sample/change_cell/cancel_run), a tray-linked cell normally stays open with 0
    uses since it's still a real physical sibling - but only as long as *some* cell in the
    tray retains real history. If removing this use leaves every one of the tray's
    CELLS_PER_TRAY cells at 0 uses, the tray was never actually loaded onto anything
    durable, so delete the whole CellTray plus all its Cell rows rather than leaving a
    "ghost" tray that lingers in the weekly grid for the rest of the week with no way to
    clear it (see docs/todo.md's tray-clearing bug).

    No-op if `cell` isn't tray-linked. Caller must already know `cell` itself has 0 uses.

    Locks the tray row first, so concurrent cleanup checks for two sibling cells in the
    same tray (e.g. "Clear schedule"/multi-remove firing one DELETE per stage concurrently
    via Promise.all - see remove_sample) serialize instead of each independently seeing the
    other's still-uncommitted removal and skipping cleanup, which would leave the tray
    behind with 0 real uses anywhere in it. No-op on SQLite (dev), which doesn't support
    FOR UPDATE but has no concurrent-writer race to begin with."""
    tray = cell.tray
    if tray is None:
        return
    db.execute(select(CellTray.id).where(CellTray.id == tray.id).with_for_update())
    db.refresh(tray, attribute_names=["cells"])
    for sibling in tray.cells:
        db.refresh(sibling, attribute_names=["cell_uses"])
        if sibling.cell_uses:
            return
    for sibling in tray.cells:
        db.delete(sibling)
    db.delete(tray)


def last_use_run_date(cell: Cell) -> date | None:
    """The run_date of the cell's most recent active use - the earliest calendar day its
    *next* use could legally start is the following weekday (reuse is always a strictly
    later date, never same-day - see docs/pacbio-sprq-nx-scheduling-reference.md #4)."""
    active_uses = [cu for cu in cell.cell_uses if cu.status != "cancelled"]
    if not active_uses:
        return None
    last = max(active_uses, key=lambda cu: (use_run_date(cu) or date.min, cu.id))
    return use_run_date(last)


def first_use_planned_start_at(cell: Cell) -> datetime | None:
    """The planned_start_at of the cycle holding the cell's *first* active use - a
    provisional stand-in for the 108h window's real anchor (cell.first_use_started_at,
    which stays null until that use is actually confirmed loaded - see run_service.py)
    so forward-looking UI can still show a concrete estimated deadline instead of treating
    an unconfirmed cell as available indefinitely."""
    active_uses = [cu for cu in cell.cell_uses if cu.status != "cancelled"]
    if not active_uses:
        return None
    first = min(active_uses, key=lambda cu: (use_run_date(cu) or date.max, cu.id))
    return first.cycle.planned_start_at if first.cycle else None


def window_hours_elapsed(cell: Cell) -> float | None:
    if cell.first_use_started_at is None:
        return None
    started = ensure_aware(cell.first_use_started_at)
    return (utcnow() - started).total_seconds() / 3600


def run_has_started(cell_use: CellUse) -> bool:
    """True once this use's run has reached its scheduled start time - the instrument
    commits to the run (and a physical cell failure becomes possible) at
    planned_start_at, independent of whether anyone has actually clicked "Confirm
    loaded" yet (instrument locking is deliberately keyed off a run merely being
    planned, not confirmed - see docs/pacbio-sprq-nx-scheduling-reference.md). Drives
    when the "Mark Failed" QC action becomes available for a use."""
    if cell_use.cycle is None:
        return False
    return utcnow() >= ensure_aware(cell_use.cycle.planned_start_at)


def undo_available(cell_use: CellUse) -> bool:
    """Whether "Undo Failed"/"Undo Aborted" would actually succeed for this use right
    now - mirrors run_service.undo_cell_use_status's own drift guard, so the frontend
    can hide the button instead of showing one that's certain to 409 ("sample has since
    moved on") once the sample has been requeued/rescheduled since the verdict."""
    if cell_use.status not in ("failed", "aborted"):
        return False
    if cell_use.sample is None:
        return True
    expected_sample_status = "failed" if cell_use.status == "failed" else "backlog"
    return cell_use.sample.status == expected_sample_status


def has_failed_use(cell: Cell) -> bool:
    """Deliberately checks "failed" only, not "aborted" - Aborted means the run/instrument
    was the problem (the sample just goes back to the backlog for a fresh attempt), not
    that this physical cell is suspect, so it doesn't drive the PacBio credit workflow."""
    return any(cu.status == "failed" for cu in cell.cell_uses)


def needs_qc_report(cell: Cell) -> bool:
    """True once a cell has a Failed use or is Stopped, until someone raises a PacBio
    case for it - drives the "unreported cells" list."""
    return (cell.status == "stopped" or has_failed_use(cell)) and cell.pacbio_reported_at is None


def awaiting_credit(cell: Cell) -> bool:
    """True once a cell has been reported to PacBio but the credit hasn't physically
    landed in the lab yet - drives the "awaiting credit" list."""
    return cell.pacbio_reported_at is not None and cell.credit_received_at is None


def serialize_cell(cell: Cell) -> CellOut:
    uses_consumed, remaining, burned = derive_cell_state(cell)
    instrument_serial, well = current_location(cell)
    return CellOut(
        id=cell.id,
        code=cell.code,
        max_uses=cell.max_uses,
        status=cell.status,
        uses_consumed=uses_consumed,
        uses_remaining=remaining,
        burned_barcodes=burned,
        window_hours_elapsed=window_hours_elapsed(cell),
        window_breached=cell.window_breached,
        current_instrument_serial=instrument_serial,
        current_well=well,
        last_use_run_date=last_use_run_date(cell),
        first_use_started_at=cell.first_use_started_at,
        first_use_planned_start_at=first_use_planned_start_at(cell),
        created_at=cell.created_at,
        stopped_reason=cell.stopped_reason,
        stopped_at=cell.stopped_at,
        has_failed_use=has_failed_use(cell),
        needs_qc_report=needs_qc_report(cell),
        awaiting_credit=awaiting_credit(cell),
        pacbio_case_number=cell.pacbio_case_number,
        pacbio_reported_at=cell.pacbio_reported_at,
        pacbio_credit_confirmed_at=cell.pacbio_credit_confirmed_at,
        credit_received_at=cell.credit_received_at,
        tray_id=cell.tray_id,
        tray_position=cell.tray_position,
        tray_size=CELLS_PER_TRAY,
    )


def serialize_cell_detail(cell: Cell) -> CellDetailOut:
    base = serialize_cell(cell)
    history: list[CellUseHistoryOut] = []
    for cu in sorted(cell.cell_uses, key=lambda x: (use_run_date(x) or date.min, x.id)):
        run_batch = cu.cycle.run_batch if cu.cycle else None
        history.append(
            CellUseHistoryOut(
                id=cu.id,
                run_batch_id=run_batch.id if run_batch else -1,
                cycle_id=cu.cycle_id,
                well=cu.well,
                status=cu.status,
                sample_id=cu.sample_id,
                sample_external_id=cu.sample.external_id if cu.sample else None,
                sample_container_id=cu.sample.container_id if cu.sample else None,
                sample_priority=cu.sample.priority if cu.sample else None,
                sample_target_oplc=cu.sample.target_oplc if cu.sample else None,
                sample_adaptive_loading=cu.sample.adaptive_loading if cu.sample else None,
                sample_full_resolution_base_q=cu.sample.full_resolution_base_q if cu.sample else None,
                sample_ccs_kinetics=cu.sample.ccs_kinetics if cu.sample else None,
                barcodes=cu.barcode_list,
                instrument_serial=(run_batch.instrument.serial_number if run_batch and run_batch.instrument else None),
                started_at=cu.started_at,
                completed_at=cu.completed_at,
                outcome_notes=cu.outcome_notes,
                run_started=run_has_started(cu),
                undo_available=undo_available(cu),
            )
        )
    return CellDetailOut(**base.model_dump(), use_history=history)


def bootstrap_cell(db: Session, req: CellBootstrapRequest) -> Cell:
    """One-time cutover tool: register a cell that's already physically in progress on
    an instrument before this system existed. Not a routine workflow - see the backend
    plan's "porting the algorithms" deviation #1.

    Each historical use is recorded as its own RunBatch+Cycle (1:1) on a distinct synthetic
    run_date, counting backward one weekday-agnostic day per use, so the unique
    (instrument_id, run_date) constraint never self-collides."""
    if req.instrument_serial:
        instrument = db.scalar(select(Instrument).where(Instrument.serial_number == req.instrument_serial))
        if instrument is None:
            raise ValueError(f"Unknown instrument serial '{req.instrument_serial}'.")
    else:
        instrument = db.scalars(select(Instrument)).first()
        if instrument is None:
            raise ValueError("No instruments configured - run migrations first.")

    code = f"BOOT-{utcnow():%Y%m%d%H%M%S%f}"
    cell = Cell(code=code, max_uses=CELL_MAX_USES, status="open", first_use_started_at=req.first_use_started_at)
    db.add(cell)
    db.flush()

    if req.uses_consumed > 0:
        now = utcnow()
        started_at = req.first_use_started_at or now
        base_date = (req.first_use_started_at or now).date()
        for i in range(req.uses_consumed):
            # earliest use gets the earliest date; each use a distinct calendar day
            run_date = base_date - timedelta(days=(req.uses_consumed - 1 - i))
            run_batch = RunBatch(instrument_id=instrument.id, run_date=run_date)
            db.add(run_batch)
            db.flush()
            cycle = Cycle(
                run_batch_id=run_batch.id,
                movie_hours=24,
                planned_start_at=now,
                planned_end_at=now,
                actual_start_at=started_at,
                actual_end_at=now,
                status="completed",
            )
            db.add(cycle)
            db.flush()
            cell_use = CellUse(
                cycle_id=cycle.id,
                cell_id=cell.id,
                sample_id=None,
                well="A01",
                status="completed",
                started_at=started_at,
                completed_at=now,
            )
            db.add(cell_use)
            db.flush()
            # The full burned-barcode set is attached to the first synthetic use only -
            # what matters going forward is the union across the cell's uses, not which
            # historical use burned which specific barcode.
            if i == 0:
                for barcode in req.burned_barcodes:
                    db.add(CellUseBarcode(cell_use_id=cell_use.id, barcode=barcode))

    db.add(
        AuditLog(
            actor=req.actor or "unknown",
            action="bootstrap_cell",
            entity_type="cell",
            entity_id=cell.id,
            details_json={
                "uses_consumed": req.uses_consumed,
                "burned_barcodes": req.burned_barcodes,
            },
        )
    )
    db.commit()
    db.refresh(cell)
    return cell


def retire_cell(db: Session, cell: Cell, actor: str | None) -> Cell:
    if any(cu.status == "planned" for cu in cell.cell_uses):
        raise ValueError("Cannot retire a cell with planned (not yet run) uses.")
    cell.status = "retired"
    db.add(
        AuditLog(actor=actor or "unknown", action="retire_cell", entity_type="cell", entity_id=cell.id, details_json={})
    )
    db.commit()
    db.refresh(cell)
    return cell


def stop_cell(db: Session, cell: Cell, reason: str | None, actor: str | None) -> tuple[Cell, list[int]]:
    """QC: take a physical cell permanently out of service - all its future uses are
    lost. Unlike retire_cell (which refuses if any planned use exists), stop_cell exists
    for exactly that situation: it cascades by cancelling every not-yet-run ("planned")
    use of this cell - the sample goes back to backlog, but the CellUse row itself is
    kept (status "cancelled"), not deleted, so the grid still shows a visible record of
    the placement that will now never happen instead of the slot silently vanishing.
    derive_cell_state() and friends already exclude "cancelled" uses from a cell's active
    counts, so this doesn't affect uses_consumed/uses_remaining/current_location. The
    well stays occupied (blocking any new placement into that exact slot) as a permanent
    marker. Already-started/completed uses are left untouched as history; only the
    cell's future is lost, not its past. Because engine_bridge.load_prior_cells only
    ever offers Cell.status == "open" for reuse, a stopped cell is automatically
    excluded from all future scheduling with no engine changes."""
    if cell.status in ("retired", "stopped"):
        raise ValueError(f"Cell is already {cell.status}.")

    bumped_sample_ids: list[int] = []
    # Per-cell_use snapshot of what's about to be cancelled, so a mistaken Stop cell (wrong
    # physical cell selected) can be undone later (see undo_stop_cell) - keyed by cell_use
    # id rather than just the sample ids stop_cell already returns, since undo needs to
    # know which specific CellUse rows to revert back to "planned".
    cancelled: dict[str, dict] = {}
    for cell_use in [cu for cu in cell.cell_uses if cu.status == "planned"]:
        prior_sample_status = cell_use.sample.status if cell_use.sample is not None else None
        if cell_use.sample is not None:
            cell_use.sample.status = "backlog"
            bumped_sample_ids.append(cell_use.sample_id)
        cell_use.status = "cancelled"
        # JSON object keys are always strings on the round trip through the DB - store
        # with str() up front so undo_stop_cell's lookup is correct however this dict is
        # read back (freshly queried, or still resident in the same session).
        cancelled[str(cell_use.id)] = {"sample_status": prior_sample_status}

    cell.status = "stopped"
    cell.stopped_at = utcnow()
    cell.stopped_reason = reason
    db.flush()

    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="stop_cell",
            entity_type="cell",
            entity_id=cell.id,
            details_json={"reason": reason, "bumped_sample_ids": bumped_sample_ids, "cancelled": cancelled},
        )
    )
    db.commit()
    db.refresh(cell)
    db.refresh(cell, attribute_names=["cell_uses"])
    return cell, bumped_sample_ids


def undo_stop_cell(db: Session, cell: Cell, actor: str | None) -> tuple[Cell, list[int], list[int]]:
    """Reverse a mistaken Stop cell (wrong physical cell selected) - reopens the cell and
    restores every use it cancelled back to "planned", so the schedule looks exactly like
    it did before the stop. A cancelled use is only revived if its sample is still sitting
    untouched in the backlog since the stop - one already requeued into a fresh placement
    elsewhere is left "cancelled" rather than revived into a second, conflicting "planned"
    use for a sample that's now committed elsewhere (mirrors undo_cell_use_status's same
    drift guard). Returns the cell plus (reverted, drifted) cell_use ids for the caller to
    report."""
    if cell.status != "stopped":
        raise ValueError("Cell is not stopped.")

    last_action = db.scalars(
        select(AuditLog)
        .where(AuditLog.entity_type == "cell", AuditLog.entity_id == cell.id, AuditLog.action == "stop_cell")
        .order_by(AuditLog.id.desc())
        .limit(1)
    ).first()
    if last_action is None or "cancelled" not in last_action.details_json:
        raise ValueError("No recorded Stop cell action found to undo.")

    cancelled = last_action.details_json["cancelled"]
    reverted_ids: list[int] = []
    drifted_ids: list[int] = []
    for cell_use in cell.cell_uses:
        snapshot = cancelled.get(str(cell_use.id))
        if snapshot is None or cell_use.status != "cancelled":
            continue
        prior_sample_status = snapshot["sample_status"]
        if cell_use.sample is not None and prior_sample_status is not None and cell_use.sample.status != "backlog":
            # Sample has since moved on (requeued/rescheduled) - reviving this slot would
            # double-book it against wherever it landed, so leave it cancelled.
            drifted_ids.append(cell_use.id)
            continue
        cell_use.status = "planned"
        reverted_ids.append(cell_use.id)
        if cell_use.sample is not None and prior_sample_status is not None:
            cell_use.sample.status = prior_sample_status

    cell.status = "open"
    cell.stopped_at = None
    cell.stopped_reason = None
    recompute_status(cell, utcnow())

    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="undo_stop_cell",
            entity_type="cell",
            entity_id=cell.id,
            details_json={"reverted_cell_use_ids": reverted_ids, "drifted_cell_use_ids": drifted_ids},
        )
    )
    db.commit()
    db.refresh(cell)
    db.refresh(cell, attribute_names=["cell_uses"])
    return cell, reverted_ids, drifted_ids


def report_cell_to_pacbio(db: Session, cell: Cell, case_number: str, actor: str | None) -> Cell:
    if cell.status != "stopped" and not has_failed_use(cell):
        raise ValueError("Cell has no failed or stopped use to report to PacBio.")
    cell.pacbio_case_number = case_number
    cell.pacbio_reported_at = utcnow()
    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="report_cell_to_pacbio",
            entity_type="cell",
            entity_id=cell.id,
            details_json={"case_number": case_number},
        )
    )
    db.commit()
    db.refresh(cell)
    return cell


def confirm_cell_credit(db: Session, cell: Cell, actor: str | None) -> Cell:
    if cell.pacbio_case_number is None:
        raise ValueError("Cell has not been reported to PacBio yet.")
    cell.pacbio_credit_confirmed_at = utcnow()
    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="confirm_cell_credit",
            entity_type="cell",
            entity_id=cell.id,
            details_json={},
        )
    )
    db.commit()
    db.refresh(cell)
    return cell


def receive_cell_credit(db: Session, cell: Cell, actor: str | None) -> Cell:
    if cell.pacbio_reported_at is None:
        raise ValueError("Cell has not been reported to PacBio yet.")
    cell.credit_received_at = utcnow()
    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="receive_cell_credit",
            entity_type="cell",
            entity_id=cell.id,
            details_json={},
        )
    )
    db.commit()
    db.refresh(cell)
    return cell
