"""Cell derivation, serialization, and the two one-off cutover actions (bootstrap/retire).

The core rule lives in derive_cell_state(): a cell's live capacity and burned-barcode
set are always computed from its real cell_uses, never manually re-entered. This is
what replaces the prototype's free-text "in-progress cells" panel.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.engine.constants import CELL_LIFETIME_H, CELL_MAX_USES, CELLS_PER_TRAY, DAY_START_HOUR, WELLS
from app.engine.packing import ABORTED_PRIORITY
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
    if cell.status in ("retired", "stopped") or cell.discarded_at is not None:
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
    uses = active_uses(cell)
    uses_consumed = len(uses)
    remaining = max(0, cell.max_uses - uses_consumed)
    burned: list[str] = []
    seen: set[str] = set()
    for cu in uses:
        for b in cu.barcode_list:
            if b not in seen:
                seen.add(b)
                burned.append(b)
    return uses_consumed, remaining, burned


def use_run_date(cell_use: CellUse) -> date | None:
    """The calendar day a specific use is/was acquired, via its Cycle (the Plate) -
    ``Cycle.acquire_date``. The only correct way to order a cell's uses chronologically.
    CellUse.id (insertion order) is not a reliable stand-in: a batch auto-fill can commit
    multiple cells' rows in an order grouped by instrument rather than by any one cell's own
    date sequence (see auto_fill_service.py's persist loop), so "inserted later" does not
    imply "happened later" once a schedule spans more than one instrument.

    (Named for the pre-split RunBatch.run_date; the value is now the plate's acquire_date,
    which for a reused cell's second use is genuinely a later day than its first use even
    though both plates were loaded in the same session.)"""
    return cell_use.cycle.acquire_date if cell_use.cycle else None


def active_uses(cell: Cell) -> list[CellUse]:
    """A cell's non-cancelled uses - the ones that count toward capacity and ordering. A
    cancelled use is a permanent Stop-cell marker, never real consumed capacity, so every
    consumed/remaining/burned/first/last derivation ignores it. Single definition so those
    derivations can't each re-inline the filter and drift."""
    return [cu for cu in cell.cell_uses if cu.status != "cancelled"]


def use_sort_key(cell_use: CellUse) -> tuple[date, int]:
    """Chronological ordering key for a cell's uses - acquire date (see use_run_date), then
    insertion id as a stable tie-break. A use with no scheduled date sorts as the distant past
    (so it ranks lowest for a max()-style "most recent use" pick). The single key used wherever
    a cell's uses are ranked by when they ran (current_location, last_use_run_date,
    serialize_cell_detail, stop_cell, run_serializer._use_number, move_sample)."""
    return (use_run_date(cell_use) or date.min, cell_use.id)


def current_location(cell: Cell) -> tuple[str | None, str | None]:
    """(instrument_serial, well) a cell physically occupies. The instrument is where its most
    recent use runs (a cell never crosses instruments once used), falling back to its tray's
    instrument for a not-yet-used sibling. The well is the cell's fixed tray IDENTITY
    (home_well) - the A/B/C/D position it keeps for life - NOT wherever a sample happened to be
    loaded: CellUse.well is a plate LOADING position now, which can differ from the cell's own
    well. Only a legacy/bootstrap cell with no tray falls back to its last use's loading well."""
    uses = active_uses(cell)
    instrument_serial: str | None = None
    if uses:
        last = max(uses, key=use_sort_key)
        run_batch = last.cycle.run_batch if last.cycle else None
        instrument = run_batch.instrument if run_batch else None
        instrument_serial = instrument.serial_number if instrument else None
    if instrument_serial is None and cell.tray is not None:
        instrument_serial = cell.tray.instrument.serial_number
    if cell.home_well is not None:
        well = cell.home_well
    elif uses:
        well = max(uses, key=use_sort_key).well
    else:
        well = None
    return instrument_serial, well


def _cell_resident_on(cell: Cell, on_date: date) -> bool:
    """Whether an open `cell` is still physically occupying its tray box as of `on_date` -
    i.e. its 108h reuse window hasn't closed by then. A never-used sibling (no first-use
    anchor, no clock running) is always resident; a previously-used cell is resident only
    while its window is still open on that day.

    Mirrors placement_service._reuse_window_open so the "can this box take a fresh tray"
    turnover decision agrees exactly with the "can this cell still be reused" one: an expired
    tray is treated as physically removed - its carousel position free to reload - at precisely
    the point it stops being reusable, not left blocking the box until its unconfirmed status
    happens to flip to window_expired against real "now" (which never happens for a cell whose
    first use was never confirmed loaded - see recompute_status). Uses the default run start
    hour (DAY_START_HOUR) as the day's reference instant, matching the reuse window's own
    default anchor."""
    anchor = cell.first_use_started_at or first_use_planned_start_at(cell)
    if anchor is None:
        return True
    deadline = ensure_aware(anchor) + timedelta(hours=CELL_LIFETIME_H)
    day_start = datetime.combine(on_date, time(hour=DAY_START_HOUR), tzinfo=timezone.utc)
    return day_start <= deadline


def open_new_tray(db: Session, instrument_id: int, well: str, *, founding_date: date | None = None) -> list[Cell]:
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
    (the one being placed right now), followed by its 3 siblings in position order.

    Raises ValueError if this box still has a live physical tray on it - some Cell already
    occupies one of its wells with `status == "open"` (real remaining capacity, or a never-
    yet-used sibling still waiting to be picked up). Callers that legitimately reuse an
    already-open box (auto_fill_service's opened_boxes cache, the frontend's waiting-cell
    ghosts) must resolve to that existing Cell instead of calling this - see
    docs/pacbio-sprq-nx-scheduling-reference.md's "Tray-of-4 eager population" bug history
    for why silently minting a second physical tray here instead of raising is how a tray
    ends up with non-continuous/duplicated cell ids. A box whose every cell has gone
    terminal (stopped/exhausted/window_expired/retired) is *not* a collision - the physical
    tray has genuinely left the instrument, mirroring the frontend's own
    waitingCells.computeVacatedTrayIds - so a brand-new tray can be loaded into it again.

    **Tray turnover on expiry (`founding_date`).** When `founding_date` is given (the acquire
    day of the placement this tray is being opened for), an open cell whose 108h reuse window
    has already closed *by that day* is treated as already gone (see _cell_resident_on) and is
    NOT a collision either. This is the "an expired tray is physically removed and a fresh one
    loaded in its place" turnover: a used cell's status only flips to window_expired against
    real "now" once its first use was confirmed loaded, so a never-confirmed tray whose
    estimated window has passed would otherwise stay `status == "open"` forever and wrongly
    block reloading its carousel position for a future run (the reported bug - dragging a
    sample onto a date the resident tray has expired silently 409'd here). The successor tray
    minted here coexists with the predecessor in the DB; the predecessor's earlier-week uses
    stay valid history, and the frontend's tray eviction logic (computeTrayEvictionDates)
    renders the predecessor as evicted from the successor's founding day on. With no
    `founding_date` (internal callers that pre-terminate the old cells themselves - stop-cell
    tray rotation, auto-fill's mid-batch reload), any open cell is still a collision.

    This collision check has no exclusion/override of any kind - it used to accept an
    `exclude_tray_id` for change_cell()'s "swap to a brand-new cell in this same well"
    path, which deliberately opened a fresh tray right on top of the one it was about to
    vacate. That let a still-live tray (one with other real, non-cancelled uses on its
    other wells) get silently duplicated whenever the vacating cell wasn't its box's only
    real occupant, since the exclusion blinded this check to those siblings too - see
    docs/pacbio-sprq-nx-scheduling-reference.md's bug history. change_cell() has been
    removed entirely rather than made to compute "is the rest of this tray actually fully
    vacated first" - there's no remaining scenario where keeping a sample in its exact slot
    while swapping in a brand-new physical cell reflects anything that can really happen;
    a box that's genuinely gone terminal is already reachable by placing a fresh backlog
    sample onto its now-empty well through the ordinary path below, unconditionally."""
    box_start = (WELLS.index(well) // CELLS_PER_TRAY) * CELLS_PER_TRAY
    box_wells = WELLS[box_start : box_start + CELLS_PER_TRAY]

    open_cells = (
        db.scalars(
            select(Cell)
            .join(Cell.tray)
            .where(CellTray.instrument_id == instrument_id, Cell.home_well.in_(box_wells), Cell.status == "open")
            .options(selectinload(Cell.cell_uses).selectinload(CellUse.cycle))
        )
        .unique()
        .all()
    )
    # A still-open cell blocks reloading the box only while it's genuinely resident: with a
    # founding_date, one whose 108h window has closed by then counts as physically removed
    # (turnover - see the docstring and _cell_resident_on); without one, every open cell blocks.
    blocked = any(founding_date is None or _cell_resident_on(c, founding_date) for c in open_cells)
    if blocked:
        raise ValueError(
            f"well {well} is already occupied by an existing physical tray (wells {box_wells}) on this instrument."
        )

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
        # Cells are numbered (PacBio "cell 1-4"), plates are lettered - the code ties each
        # cell to its physical tray: C01-T123 .. C04-T123 are the 4 cells of tray 123. The
        # position (1-4) and tray.id are both known here, so the code no longer needs the
        # cell's own PK. See docs/pacbio-sprq-nx-scheduling-reference.md's vocabulary map.
        cell.code = f"C{position:02d}-T{tray.id}"
        if home_well == well:
            placed = cell
        else:
            siblings.append(cell)
    assert placed is not None, f"well {well!r} not found in its own tray box {box_wells!r}"
    return [placed, *siblings]


def cleanup_tray_if_fully_unused(db: Session, cell: Cell) -> None:
    """The tray-wide counterpart to open_new_tray(): once a placement's last use is removed
    (remove_sample/move_sample/cancel_run), a tray-linked cell normally stays open with 0
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
    uses = active_uses(cell)
    if not uses:
        return None
    last = max(uses, key=use_sort_key)
    return use_run_date(last)


def first_use_planned_start_at(cell: Cell) -> datetime | None:
    """The planned_start_at of the cycle holding the cell's *first* active use - a
    provisional stand-in for the 108h window's real anchor (cell.first_use_started_at,
    which stays null until that use is actually confirmed loaded - see run_service.py)
    so forward-looking UI can still show a concrete estimated deadline instead of treating
    an unconfirmed cell as available indefinitely."""
    uses = active_uses(cell)
    if not uses:
        return None
    # Earliest use: nulls sort *last* here (date.max), the opposite of use_sort_key's
    # most-recent bias - a use with no scheduled date must not be picked as the "first".
    first = min(uses, key=lambda cu: (use_run_date(cu) or date.max, cu.id))
    return first.cycle.planned_start_at if first.cycle else None


def window_hours_elapsed(cell: Cell) -> float | None:
    if cell.first_use_started_at is None:
        return None
    started = ensure_aware(cell.first_use_started_at)
    return (utcnow() - started).total_seconds() / 3600


def run_has_started(cell_use: CellUse) -> bool:
    """True once this use's cycle has been locked in ("Confirm loaded" clicked, cycle
    status no longer "planned") - once the tray is physically on the instrument, a real
    QC problem (Fail/Stop) becomes possible, regardless of the cycle's original
    planned_start_at. Drives when "Mark Failed"/"Stop cell" become available for a use -
    both are gated the same way so they always appear/disappear together."""
    if cell_use.cycle is None:
        return False
    return cell_use.cycle.status != "planned"


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
        discarded_reason=cell.discarded_reason,
        discarded_at=cell.discarded_at,
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
    for cu in sorted(cell.cell_uses, key=use_sort_key):
        run_batch = cu.cycle.run_batch if cu.cycle else None
        history.append(
            CellUseHistoryOut(
                id=cu.id,
                run_batch_id=run_batch.id if run_batch else -1,
                cycle_id=cu.cycle_id,
                plate_index=cu.cycle.plate_index if cu.cycle else None,
                run_name=run_batch.run_name if run_batch else None,
                well=cu.well,
                status=cu.status,
                sample_id=cu.sample_id,
                sample_external_id=cu.sample.external_id if cu.sample else None,
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

    Each historical use is recorded as its own Run (RunBatch) + single Plate (Cycle) on a
    distinct synthetic date, counting backward one weekday-agnostic day per use, so the
    unique (instrument_id, load_date) constraint never self-collides."""
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
            run_batch = RunBatch(instrument_id=instrument.id, load_date=run_date)
            db.add(run_batch)
            db.flush()
            cycle = Cycle(
                run_batch_id=run_batch.id,
                plate_index=1,
                acquire_date=run_date,
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
                run_time_hours=24,  # matches this synthetic cycle's movie_hours
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


def _reallocate_bumped_uses(stopped_cell: Cell, bumped_uses: list[CellUse]) -> tuple[list[tuple[CellUse, Cell]], list[CellUse]]:
    """Re-home each bumped later-use of a just-stopped cell onto the next-usable sibling in its
    own physical tray - the ICS "the tray's other cells absorb the load" behaviour. Each use
    keeps its day and plate slot; only which physical cell backs it changes (a grid slot is a
    loading position, not a cell). Same-tray only: a cell never crosses to another tray or
    instrument, so a bumped sample can only be rescued by a sibling in the very tray that's
    still loaded. Returns (rehomed, overflow): the (use, new_cell) reassignments made, and the
    uses that no longer fit anywhere in the tray - their samples can't run and must be alerted.

    Reuse-before-new, most-used sibling first (its 108h clock is nearest expiry, so it's
    finished before a fresher one), then tray order. Accounts, as it goes, for every
    reassignment already made this pass: capacity (max_uses), one-use-per-day, the 108h window
    (~4.5 days from a cell's first use), and burned-barcode clashes."""
    tray = stopped_cell.tray
    if tray is None:
        return [], list(bumped_uses)
    state = [
        {
            "cell": sib,
            "days": [d for u in active_uses(sib) if (d := use_run_date(u)) is not None],
            "barcodes": {b for u in active_uses(sib) for b in u.barcode_list},
        }
        for sib in tray.cells
        if sib.id != stopped_cell.id and sib.status == "open"
    ]

    rehomed: list[tuple[CellUse, Cell]] = []
    overflow: list[CellUse] = []
    # Rescue earliest-day uses first, so the tray's remaining capacity fills front-to-back and
    # any overflow lands on the latest days (the tail), matching how the run would actually play out.
    for use in sorted(bumped_uses, key=use_sort_key):
        acquire = use_run_date(use)
        sample_bcs = set(use.barcode_list)
        chosen: dict | None = None
        for s in sorted(state, key=lambda s: (-len(s["days"]), s["cell"].tray_position if s["cell"].tray_position is not None else 99)):
            if len(s["days"]) >= s["cell"].max_uses:
                continue  # no capacity left
            if acquire is not None and acquire in s["days"]:
                continue  # a cell can't run twice on one day
            if sample_bcs & s["barcodes"]:
                continue  # burned-barcode clash
            if acquire is not None and s["days"]:
                span = (max(s["days"] + [acquire]) - min(s["days"] + [acquire])).days
                if span > 4:  # 108h ~= 4.5 days from the cell's first use
                    continue
            chosen = s
            break
        if chosen is None:
            overflow.append(use)
        else:
            if acquire is not None:
                chosen["days"].append(acquire)
            chosen["barcodes"] |= sample_bcs
            rehomed.append((use, chosen["cell"]))
    return rehomed, overflow


def stop_cell(
    db: Session, cell: Cell, reason: str | None, actor: str | None, cell_use_id: int | None = None
) -> tuple[Cell, list[int], list[int]]:
    """QC: take a physical cell permanently out of service. Two things happen, anchored
    on `cell_use_id` - the specific use that triggered the stop (e.g. the one the lab
    user was viewing in the Scheduler grid's slot popover when the cell died mid-run):

    1. That triggering use itself is treated exactly like a Mark Failed verdict - no
       usable data was produced, so its sample is lost (sample.status "failed", driving
       the PacBio credit workflow via has_failed_use/needs_qc_report) rather than being
       requeued.
    2. Every *later* (chronologically, via use_run_date) not-yet-run use of this cell is
       RE-ALLOCATED onto the tray's remaining cells - the ICS reshuffle-on-failure behaviour:
       the instrument reruns the tray's other cells, so each bumped sample shifts onto the
       next-usable sibling for its own day (reuse-before-new; see _reallocate_bumped_uses).
       Whatever no longer fits anywhere in the tray - because the stopped cell's lost capacity
       shortened the queue - can no longer run: those samples go back to the backlog (tagged
       ABORTED_PRIORITY) and are reported as unrunnable so the user is alerted. Uses *before*
       the trigger are left completely untouched, regardless of status - an already-run
       earlier use is immune to a later stop.

    `cell_use_id` is optional for a whole-cell Stop not anchored to any one use (e.g. the
    Cell Detail page's generic Stop) - in that case no use is marked Failed and every
    still-"planned" use cell-wide is reshuffled/overflowed the same way.

    A reassigned use keeps its day and plate slot; only which physical cell backs it changes
    (a grid slot is a loading position, not a cell) - the card follows on its stub. An overflow
    use is kept as a "cancelled" marker (not deleted) so the grid still shows what will now
    never run. Because engine_bridge.load_prior_cells only offers Cell.status == "open", a
    stopped cell is excluded from all future scheduling with no engine changes. Returns the
    cell plus (rehomed_sample_ids, unrunnable_sample_ids)."""
    if cell.status in ("retired", "stopped"):
        raise ValueError(f"Cell is already {cell.status}.")

    origin_use: CellUse | None = None
    if cell_use_id is not None:
        origin_use = next((cu for cu in cell.cell_uses if cu.id == cell_use_id), None)
        if origin_use is None:
            raise ValueError("That use does not belong to this cell.")
        if origin_use.status not in ("planned", "started"):
            raise ValueError(f"Cannot stop from a use that is already {origin_use.status}.")
        if not run_has_started(origin_use):
            raise ValueError("Cannot stop from a use before its run is locked in.")

    ordered = sorted(cell.cell_uses, key=use_sort_key)
    origin_index = ordered.index(origin_use) if origin_use is not None else None

    # Per-cell_use snapshot of what's about to change, so a mistaken Stop cell can be undone
    # later (see undo_stop_cell) - keyed by cell_use id, tagged with which kind of change it
    # was so undo knows how to revert it.
    cancelled: dict[str, dict] = {}
    at = utcnow()
    bumped_uses: list[CellUse] = []
    for i, cell_use in enumerate(ordered):
        if origin_use is not None and cell_use.id == origin_use.id:
            prior_sample_status = cell_use.sample.status if cell_use.sample is not None else None
            cancelled[str(cell_use.id)] = {
                "outcome": "failed",
                "prior_status": cell_use.status,
                "prior_started_at": cell_use.started_at.isoformat() if cell_use.started_at else None,
                "prior_completed_at": cell_use.completed_at.isoformat() if cell_use.completed_at else None,
                "prior_outcome_notes": cell_use.outcome_notes,
                "sample_status": prior_sample_status,
            }
            cell_use.started_at = cell_use.started_at or at
            cell_use.completed_at = at
            if reason:
                cell_use.outcome_notes = reason
            cell_use.status = "failed"
            if cell_use.sample is not None:
                cell_use.sample.status = "failed"
            continue

        if cell_use.status != "planned":
            continue
        if origin_index is not None and i <= origin_index:
            # Before (or, degenerately, at) the trigger point - untouched history/queue.
            continue
        bumped_uses.append(cell_use)

    # Reshuffle the bumped uses onto the tray's remaining cells; whatever doesn't fit overflows.
    rehomed, overflow = _reallocate_bumped_uses(cell, bumped_uses)

    rehomed_sample_ids: list[int] = []
    for use, sibling in rehomed:
        # JSON object keys round-trip through the DB as strings - store with str() up front so
        # undo_stop_cell's lookup is correct however the audit row is read back.
        cancelled[str(use.id)] = {
            "outcome": "reassigned",
            "prior_cell_id": use.cell_id,
            "sample_status": use.sample.status if use.sample is not None else None,
        }
        use.cell = sibling  # keep both sides of the relationship in sync (no delete-orphan on Cell.cell_uses)
        if use.sample_id is not None:
            rehomed_sample_ids.append(use.sample_id)

    unrunnable_sample_ids: list[int] = []
    for use in overflow:
        prior_sample_status = use.sample.status if use.sample is not None else None
        prior_priority = use.sample.priority if use.sample is not None else None
        if use.sample is not None:
            use.sample.status = "backlog"
            use.sample.priority = ABORTED_PRIORITY
            unrunnable_sample_ids.append(use.sample_id)
        use.status = "cancelled"
        cancelled[str(use.id)] = {
            "outcome": "cancelled",
            "sample_status": prior_sample_status,
            "sample_priority": prior_priority,
        }

    cell.status = "stopped"
    cell.stopped_at = at
    cell.stopped_reason = reason
    db.flush()

    # A sibling that absorbed reassigned uses may now be exhausted/window_expired - recompute.
    for sibling in {s.id: s for _u, s in rehomed}.values():
        db.refresh(sibling, attribute_names=["cell_uses"])
        recompute_status(sibling, at)

    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="stop_cell",
            entity_type="cell",
            entity_id=cell.id,
            details_json={
                "reason": reason,
                "rehomed_sample_ids": rehomed_sample_ids,
                "unrunnable_sample_ids": unrunnable_sample_ids,
                "cancelled": cancelled,
            },
        )
    )
    db.commit()
    db.refresh(cell)
    db.refresh(cell, attribute_names=["cell_uses"])
    return cell, rehomed_sample_ids, unrunnable_sample_ids


def mark_cell_discarded(cell: Cell, reason: str | None, at: datetime | None = None) -> None:
    """Flip a cell to the sticky, terminal "discarded" state - status "exhausted", guarded
    by discarded_at so recompute_status never reopens it - WITHOUT touching any of its uses.

    discard_cell/discard_tray layer use-cancellation on top of this (a discard writes the
    cell off, so its still-planned uses are lost). rotate_tray uses it bare: a rotate *moves*
    the cell's future uses onto a fresh tray rather than cancelling them, and it must never
    cancel the cell's *earlier* uses either - doing so is exactly the retroactive-blocking
    bug that motivated the rotate action (an earlier, already-scheduled use turning into an
    un-removable "Blocked" slot). Caller commits."""
    cell.status = "exhausted"
    cell.discarded_at = at or utcnow()
    cell.discarded_reason = reason


def _discard_cell_uncommitted(cell: Cell, reason: str | None, actor: str | None) -> list[int]:
    """Shared body of discard_cell/discard_tray - forces a cell to "exhausted" regardless
    of its actual remaining use count (the single-cell "Discard remaining use(s)" and the
    Cells page's per-tray "Discard all cells"). Cancels planned uses exactly like stop_cell
    (sample goes back to backlog, the CellUse row is kept as "cancelled" rather than
    deleted), but the resulting status is "exhausted" - not "stopped" - since a discarded
    cell reads to the lab as "used up", not "pulled for a QC problem". discarded_at is the
    sticky guard that keeps recompute_status from ever reopening it. Caller commits.

    NOTE: this cancels *every* planned use regardless of date, so a discarded-blocked
    ("Blocked") slot can be recovered via placement_service.return_cancelled_use_to_backlog.
    The weekly-schedule grid no longer discards a whole tray this way - it rotates the tray
    (rotate_tray) so future uses move to a fresh tray instead of being cancelled."""
    bumped_sample_ids: list[int] = []
    for cell_use in [cu for cu in cell.cell_uses if cu.status == "planned"]:
        if cell_use.sample is not None:
            cell_use.sample.status = "backlog"
            bumped_sample_ids.append(cell_use.sample_id)
        cell_use.status = "cancelled"

    mark_cell_discarded(cell, reason)
    return bumped_sample_ids


def discard_cell(db: Session, cell: Cell, reason: str | None, actor: str | None) -> tuple[Cell, list[int]]:
    if cell.status in ("retired", "stopped") or cell.discarded_at is not None:
        raise ValueError(f"Cell is already {cell.status}.")

    bumped_sample_ids = _discard_cell_uncommitted(cell, reason, actor)
    db.flush()
    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="discard_cell",
            entity_type="cell",
            entity_id=cell.id,
            details_json={"reason": reason, "bumped_sample_ids": bumped_sample_ids},
        )
    )
    db.commit()
    db.refresh(cell)
    db.refresh(cell, attribute_names=["cell_uses"])
    return cell, bumped_sample_ids


def discard_tray(db: Session, cells: list[Cell], reason: str | None, actor: str | None) -> list[Cell]:
    """Bulk counterpart of discard_cell for every physical cell in one tray - a single
    "Discard Cells" click on the weekly schedule grid's tray header discards all
    CELLS_PER_TRAY siblings in one transaction. Cells already retired/stopped/discarded
    are left untouched rather than raising, since a tray can easily have a mix (e.g. one
    sibling already stopped for QC) and the lab just wants the rest cleared out."""
    discarded: list[Cell] = []
    for cell in cells:
        if cell.status in ("retired", "stopped") or cell.discarded_at is not None:
            continue
        bumped_sample_ids = _discard_cell_uncommitted(cell, reason, actor)
        db.add(
            AuditLog(
                actor=actor or "unknown",
                action="discard_cell",
                entity_type="cell",
                entity_id=cell.id,
                details_json={"reason": reason, "bumped_sample_ids": bumped_sample_ids, "tray_discard": True},
            )
        )
        discarded.append(cell)

    db.commit()
    for cell in discarded:
        db.refresh(cell)
        db.refresh(cell, attribute_names=["cell_uses"])
    return cells


def rotate_tray(
    db: Session, cells: list[Cell], from_date: date, reason: str | None, actor: str | None
) -> tuple[list[Cell], int]:
    """Replace a physical SMRT Cell tray with a fresh one, starting `from_date` - the weekly
    schedule grid's per-tray "rotate" action (it superseded the old blanket "Discard Cells"
    on the grid). Models what really happens in the lab when a tray is pulled and a new one
    loaded into the same instrument bay:

    - Every use of this tray's cells on/after `from_date` moves onto a brand-new tray minted
      in the same physical box (same instrument, same 4 wells), keeping its day/well/sample/
      barcodes. Use-numbering restarts from that day - it's derived live by run_date order
      (run_serializer._use_number) - so a sample that was this cell's Use 3 becomes Use 1 on
      the fresh cell, and later uses that also moved renumber behind it.
    - Uses *before* `from_date` stay on the old cells, untouched, as real history. The old
      cells are marked discarded (terminal, sticky - see mark_cell_discarded) but keep those
      uses. This is the crucial difference from the old whole-tray discard, which cancelled
      every planned use regardless of date and stranded already-scheduled earlier uses as
      un-removable "Blocked" slots (the bug this action fixes).

    Because the old cells go terminal and the fresh tray's earliest use is `from_date`, the
    grid's existing tray-turnover rendering takes over with no special-casing: the old tray
    reads as vacated (computeVacatedTrayIds) and the new one founds on `from_date`
    (computeTrayFoundingDates) - see docs/pacbio-sprq-nx-scheduling-reference.md.

    Raises ValueError (mapped to 409 by the endpoint) if the tray has a cell that's stopped/
    retired/already-discarded (resolve that first - a mixed-QC tray isn't a clean rotate), or
    if a use on/after `from_date` sits on a run that's already confirmed loaded (its cells are
    physically in the instrument; unlock it first). Caller need not commit - this commits."""
    if not cells:
        raise ValueError("Tray has no cells.")
    tray = cells[0].tray
    if tray is None:
        raise ValueError("These cells aren't part of a physical tray.")
    tray_id = tray.id
    instrument_id = tray.instrument_id
    box_well = cells[0].home_well
    if box_well is None:
        raise ValueError("This tray's cells have no home well; it can't be rotated.")
    old_cell_ids = [c.id for c in cells]

    for cell in cells:
        if cell.status in ("retired", "stopped") or cell.discarded_at is not None:
            raise ValueError(f"Cell {cell.code} is {cell.status}; resolve it before rotating this tray.")

    moving: list[CellUse] = []
    for cell in cells:
        for cu in cell.cell_uses:
            if cu.status == "cancelled":
                continue
            used_on = use_run_date(cu)
            if used_on is not None and used_on >= from_date:
                moving.append(cu)
    for cu in moving:
        if cu.cycle is None or cu.cycle.status != "planned":
            raise ValueError(
                "A run on or after this day is already confirmed loaded; unlock it before rotating the tray."
            )

    now = utcnow()
    # 1. Old cells go terminal (non-"open") so open_new_tray's box-collision check passes,
    #    while keeping all their uses - the moving ones are re-pointed below; the earlier
    #    ones stay as history. flush() so the collision query (a raw SELECT) sees the new
    #    status: this session is autoflush=False (see db.py).
    for cell in cells:
        mark_cell_discarded(cell, reason, now)
    db.flush()

    # 2. Mint the fresh tray in the same box; index its 4 cells by their fixed home well.
    new_cells = open_new_tray(db, instrument_id, box_well)
    new_by_well = {c.home_well: c for c in new_cells}

    # 3. Re-point each moving use onto the fresh cell in its well (same day/well/sample/
    #    barcodes). Assign via the relationship, not the raw FK - Cell.cell_uses has no
    #    delete-orphan cascade, so this is safe and keeps both back_populates sides in sync.
    moved_sample_ids: list[int] = []
    for cu in moving:
        target = new_by_well.get(cu.well)
        if target is None:  # a well outside this box - impossible for a tray-linked cell
            raise ValueError(f"Cell use in well {cu.well} doesn't belong to this tray box.")
        cu.cell = target
        if cu.sample_id is not None:
            moved_sample_ids.append(cu.sample_id)
    db.flush()

    # 4. New cells derive open + their moved-use count. Old cells were fully set by
    #    mark_cell_discarded (recompute_status early-returns on discarded_at), so they need
    #    no recompute here.
    for cell in new_cells:
        db.refresh(cell, attribute_names=["cell_uses"])
        recompute_status(cell, now)

    # 5. Rotating on the tray's very first scheduled day moves every use off it, leaving the
    #    old tray with no history at all - delete it rather than leaving an empty discarded
    #    tray in the box alongside the fresh one. No-op otherwise (some earlier use remains).
    cleanup_tray_if_fully_unused(db, cells[0])

    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="rotate_tray",
            entity_type="cell_tray",
            entity_id=tray_id,
            details_json={
                "from_date": from_date.isoformat(),
                "reason": reason,
                "old_cell_ids": old_cell_ids,
                "new_cell_ids": [c.id for c in new_cells],
                "moved_cell_use_ids": [cu.id for cu in moving],
                "moved_sample_ids": moved_sample_ids,
            },
        )
    )
    db.commit()
    for cell in new_cells:
        db.refresh(cell)
        db.refresh(cell, attribute_names=["cell_uses"])
    return new_cells, len(moving)


def undo_stop_cell(db: Session, cell: Cell, actor: str | None) -> tuple[Cell, list[int], list[int]]:
    """Reverse a mistaken Stop cell (wrong physical cell/use selected) - reopens the cell
    and restores every use it touched back to its pre-stop state, so the schedule looks
    exactly like it did before the stop. Each touched use was snapshotted as one of two
    kinds (see stop_cell): the triggering use (kind "failed", its sample lost), a later use
    re-homed onto a tray sibling (kind "reassigned"), or an overflow use bumped to the backlog
    (kind "cancelled", tagged ABORTED_PRIORITY). A use is only reverted if it's still sitting in
    its expected post-stop state - one already requeued/rescheduled/moved elsewhere is left as
    is rather than reverted into a conflicting state for a sample now committed elsewhere
    (mirrors undo_cell_use_status's drift guard). Returns the cell plus (reverted, drifted)
    cell_use ids for the caller to report."""
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
    # A "reassigned" use now lives on a sibling cell, not this one, so load every touched use by
    # id rather than iterating only this cell's own uses.
    snapshot_ids = [int(k) for k in cancelled]
    uses = list(db.scalars(select(CellUse).where(CellUse.id.in_(snapshot_ids)))) if snapshot_ids else []
    reverted_ids: list[int] = []
    drifted_ids: list[int] = []
    touched_cell_ids: set[int] = set()  # siblings that lose a reverted reassignment -> recompute
    for cell_use in uses:
        snapshot = cancelled.get(str(cell_use.id))
        if snapshot is None:
            continue
        outcome = snapshot.get("outcome", "cancelled")  # back-compat: pre-existing audit rows had only the cascade kind
        prior_sample_status = snapshot["sample_status"]

        if outcome == "failed":
            if cell_use.status != "failed":
                continue
            if cell_use.sample is not None and prior_sample_status is not None and cell_use.sample.status != "failed":
                drifted_ids.append(cell_use.id)
                continue
            cell_use.status = snapshot.get("prior_status", "planned")
            prior_started_at = snapshot.get("prior_started_at")
            cell_use.started_at = ensure_aware(datetime.fromisoformat(prior_started_at)) if prior_started_at else None
            prior_completed_at = snapshot.get("prior_completed_at")
            cell_use.completed_at = (
                ensure_aware(datetime.fromisoformat(prior_completed_at)) if prior_completed_at else None
            )
            cell_use.outcome_notes = snapshot.get("prior_outcome_notes")
            reverted_ids.append(cell_use.id)
            if cell_use.sample is not None and prior_sample_status is not None:
                cell_use.sample.status = prior_sample_status
            continue

        if outcome == "reassigned":
            # Was moved onto a sibling (sample stayed scheduled). Move it back onto the
            # now-reopened cell, unless it's since drifted (moved again / no longer planned).
            prior_cell_id = snapshot.get("prior_cell_id")
            if prior_cell_id is None or cell_use.cell_id == prior_cell_id:
                continue
            if cell_use.status != "planned":
                drifted_ids.append(cell_use.id)
                continue
            touched_cell_ids.add(cell_use.cell_id)  # the sibling it currently sits on
            cell_use.cell_id = prior_cell_id
            reverted_ids.append(cell_use.id)
            continue

        if cell_use.status != "cancelled":
            continue
        if cell_use.sample is not None and prior_sample_status is not None and cell_use.sample.status != "backlog":
            # Sample has since moved on (requeued/rescheduled) - reviving this slot would
            # double-book it against wherever it landed, so leave it cancelled.
            drifted_ids.append(cell_use.id)
            continue
        cell_use.status = "planned"
        reverted_ids.append(cell_use.id)
        if cell_use.sample is not None and prior_sample_status is not None:
            cell_use.sample.status = prior_sample_status
            if "sample_priority" in snapshot:
                cell_use.sample.priority = snapshot["sample_priority"]

    cell.status = "open"
    cell.stopped_at = None
    cell.stopped_reason = None
    db.flush()
    # A sibling that gave a reassigned use back may drop below its cap - recompute it too.
    for cid in touched_cell_ids:
        sib = db.get(Cell, cid)
        if sib is not None:
            db.refresh(sib, attribute_names=["cell_uses"])
            recompute_status(sib, utcnow())
    db.refresh(cell, attribute_names=["cell_uses"])
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
