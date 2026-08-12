"""Cell derivation, serialization, and the two one-off cutover actions (bootstrap/retire).

The core rule lives in derive_cell_state(): a cell's live capacity and burned-barcode
set are always computed from its real cell_uses, never manually re-entered. This is
what replaces the prototype's free-text "in-progress cells" panel.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.engine.constants import (
    CELL_LIFETIME_H,
    CELL_MAX_USES,
    CELLS_PER_TRAY,
    DAY_START_HOUR,
    WELLS,
    within_tray_pos,
)
from app.models.audit import AuditLog
from app.models.cell import Cell
from app.models.cell_tray import CellTray
from app.models.instrument import Instrument
from app.models.schedule import CellUse, CellUseBarcode, Cycle, RunBatch
from app.schemas.cell import CellBootstrapRequest, CellDetailOut, CellOut, CellUseHistoryOut, CellUseSummaryOut
from app.services.cell_timing import cell_use_movie_end_at
from app.timeutil import ensure_aware, utcnow


def derive_status(remaining: int, window_breached: bool) -> str:
    """The non-terminal status a cell derives from its capacity + window state. The single
    rule shared by the persisted path (recompute_status) and the read-only "as of" projection
    (serialize_cell) so the two can't drift. Callers handle terminal states (retired/stopped/
    discarded) themselves - those are sticky and never re-derived from capacity."""
    if remaining <= 0:
        return "exhausted"
    if window_breached:
        return "window_expired"
    return "open"


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
    cell.status = derive_status(remaining, cell.window_breached)


def derive_cell_state(cell: Cell, uses: list[CellUse] | None = None) -> tuple[int, int, list[str]]:
    uses = active_uses(cell) if uses is None else uses
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


def barcode_owners(cell: Cell, uses: list[CellUse] | None = None) -> dict[str, set[str]]:
    """barcode -> the set of Pool IDs (Sample.pool_id) that have burned it on this
    cell across its active uses. Lets a clash check tell "a different sample happens to share
    this barcode" (a real cross-contamination risk) apart from "another copy of the exact same
    Pool ID already used this cell" (the same physical material either way - see
    foreign_barcode_clash)."""
    uses = active_uses(cell) if uses is None else uses
    owners: dict[str, set[str]] = {}
    for cu in uses:
        ext = cu.sample.pool_id if cu.sample else None
        if ext is None:
            continue
        for b in cu.barcode_list:
            owners.setdefault(b, set()).add(ext)
    return owners


def foreign_barcode_clash(owners: dict[str, set[str]], pool_id: str | None, barcodes: list[str]) -> bool:
    """True if any of `barcodes` was burned on a cell by a DIFFERENT Pool ID than
    `pool_id` - the real reuse-carryover risk the barcode guard exists to prevent (see
    docs/pacbio-sprq-nx-scheduling-reference.md's barcode-carryover rule). A barcode only ever
    burned by `pool_id` itself - another copy of the same duplicate Pool ID (see
    "duplicate Pool ID" sample support) - is NOT a clash: reusing a cell with the
    identical physical sample can't misattribute reads to a foreign sample, so there's nothing
    for the carryover guard to protect against (lab owner decision, 2026-07-29). `pool_id`
    of None (a legacy cell_use with no linked sample) can never claim this exemption - treated
    as foreign to every burned barcode, matching the guard's pre-existing behaviour."""
    for b in barcodes:
        owners_of_b = owners.get(b)
        if not owners_of_b:
            continue
        if pool_id is None or owners_of_b - {pool_id}:
            return True
    return False


def is_duplicate_cell_reuse(cell_use: CellUse) -> bool:
    """True if this use's cell was already used by another CellUse of the exact same
    Pool ID (a sibling duplicate sharing a barcode) - an intentionally ALLOWED reuse (see
    foreign_barcode_clash), surfaced on the placement so it's transparent at a glance rather
    than a silent rule exception. Distinct from has_barcode_clash, which flags the opposite
    (and genuinely unexpected) case: a clash with a DIFFERENT sample."""
    cell = cell_use.cell
    if cell is None or cell_use.sample is None:
        return False
    mine = cell_use.barcode_list
    if not mine:
        return False
    others = [u for u in active_uses(cell) if u.id != cell_use.id]
    owners = barcode_owners(cell, others)
    pool_id = cell_use.sample.pool_id
    return any(pool_id in owners.get(b, set()) for b in mine)


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


def current_location(cell: Cell, uses: list[CellUse] | None = None) -> tuple[str | None, str | None]:
    """(instrument_serial, well) a cell physically occupies. The instrument is where its most
    recent use runs (a cell never crosses instruments once used), falling back to its tray's
    instrument for a not-yet-used sibling. The well is the cell's fixed tray IDENTITY
    (home_well) - the A/B/C/D position it keeps for life - NOT wherever a sample happened to be
    loaded: CellUse.well is a plate LOADING position now, which can differ from the cell's own
    well. Only a legacy/bootstrap cell with no tray falls back to its last use's loading well."""
    uses = active_uses(cell) if uses is None else uses
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


def _ready_after(prior_use: CellUse) -> datetime | None:
    """When a cell is physically free for its NEXT use = its prior use's real movie end
    (cell_timing.cell_use_movie_end_at, lane/prep-aware). The on-board reuse wash is no longer
    added here - it's the reuse cell's own prep now (the extra REUSE_PREP_H in cell_timing, applied
    after the reuse loads), so 'free for the next use' is simply 'the prior movie has finished'.
    Shared by cell_ready_at and reuse_not_ready_hours below."""
    return cell_use_movie_end_at(prior_use)


def cell_ready_at(cell: Cell) -> datetime | None:
    """When `cell` is physically free for its NEXT use - its most recent active use's real movie
    end (cell_timing.cell_use_movie_end_at, lane/prep-aware). None when the cell has no uses yet
    (nothing to wait for - immediately available) or its last use's run isn't loaded. Advisory only
    (see docs/pacbio-sprq-nx-scheduling-reference.md's "Deliberate simplifications") - nothing gates
    a placement on this, it only feeds reuse_not_ready_hours."""
    uses = active_uses(cell)
    if not uses:
        return None
    return _ready_after(max(uses, key=use_sort_key))


def reuse_not_ready_hours(cell_use: CellUse) -> float | None:
    """Advisory only: hours by which `cell_use`'s own start preceded its cell's real physical
    readiness (the immediately-prior active use's movie end - when the cell finishes its prior
    acquisition and is free to load again). None when this is the cell's first use, the prior use's
    run isn't loaded, or the start was already safely at/after readiness - only a genuine shortfall
    is reported. Anchored on the real confirmed
    start once known (Cycle.actual_start_at), else planned - same actual-beats-planned
    precedence as cell_timing._plate_anchor.

    A `failed` (not cancelled) prior use still counts via active_uses() - the instrument was
    still physically occupied for that use's full duration even though the run failed, so it
    still governs when the cell is next free."""
    cell = cell_use.cell
    if cell is None:
        return None
    ordered = sorted(active_uses(cell), key=use_sort_key)
    idx = next((i for i, u in enumerate(ordered) if u.id == cell_use.id), None)
    if idx is None or idx == 0:
        return None
    ready_at = _ready_after(ordered[idx - 1])
    cycle = cell_use.cycle
    if ready_at is None or cycle is None:
        return None
    start = ensure_aware(cycle.actual_start_at or cycle.planned_start_at)
    shortfall = (ready_at - start).total_seconds() / 3600
    return shortfall if shortfall > 0 else None


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

    `well` is the well the sample is landing in right now (e.g. "C01"). A cell tray and a sample
    plate are INDEPENDENT instrument positions (see docs/pacbio-sprq-nx-scheduling-reference.md's
    "Plate vs cell"), so the fresh tray loads into a free cell-tray BAY - the drop well's own bay
    if free (the common case), else the other free bay - not necessarily the bay whose wells match
    `well`. The 4 cells are pinned to that chosen bay's wells (Cell.home_well/tray_position, fixed
    A/B/C/D order); the sample keeps the drop well's tray POSITION, so it loads into `well` even
    when its cell's home_well is in the other bay (the loading-well != home-well split).

    Returns the 4 cells reordered so index 0 is the cell whose tray POSITION matches the drop well
    (within_tray_pos) - whose home_well equals `well` only when the tray landed in the drop well's
    own bay - followed by its 3 siblings in position order.

    Raises ValueError only if BOTH cell-tray bays are occupied by live physical trays - some Cell
    in each bay with `status == "open"` (real remaining capacity, or a never-yet-used sibling still
    waiting to be picked up). Callers that legitimately reuse an already-open box
    (auto_fill_service's opened_boxes cache, the frontend's waiting-cell ghosts) must resolve to
    that existing Cell instead of calling this - see docs/pacbio-sprq-nx-scheduling-reference.md's
    "Tray-of-4 eager population" bug history for why silently minting a second physical tray in a
    bay instead of raising is how a tray ends up with non-continuous/duplicated cell ids. A bay
    whose every cell has gone terminal (stopped/exhausted/window_expired/retired) is *not* occupied
    - the physical tray has genuinely left the instrument, mirroring the frontend's own
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
    drop_bay = WELLS.index(well) // CELLS_PER_TRAY
    pos = within_tray_pos(well)  # 0-3, the tray position the sample occupies (kept for life)
    bay_count = len(WELLS) // CELLS_PER_TRAY  # 2

    # Every open cell on this instrument, so each cell-tray bay's occupancy can be tested.
    open_cells = (
        db.scalars(
            select(Cell)
            .join(Cell.tray)
            .where(CellTray.instrument_id == instrument_id, Cell.status == "open")
            .options(selectinload(Cell.cell_uses).selectinload(CellUse.cycle))
        )
        .unique()
        .all()
    )

    def _bay_blocked(bay: int) -> bool:
        # A still-open cell blocks reloading a bay only while genuinely resident: with a
        # founding_date, one whose 108h window has closed by then counts as physically removed
        # (turnover - see _cell_resident_on); without one, every open cell blocks. A cell whose
        # tray is flagged "skip reuse / planning disposal" (CellTray.reuse_disabled_at) never
        # blocks: the lab has declared it's binning that tray, so the bay is free for a fresh
        # tray - the same "being removed" model as an expired tray. (Predicate byte-identical to
        # the former single-box guard; only its scope is now per-bay.)
        lo = bay * CELLS_PER_TRAY
        bay_wells = set(WELLS[lo : lo + CELLS_PER_TRAY])
        return any(
            (c.tray is None or c.tray.reuse_disabled_at is None)
            and (founding_date is None or _cell_resident_on(c, founding_date))
            for c in open_cells
            if c.home_well in bay_wells
        )

    # A cell tray and a sample plate are independent instrument positions: a fresh tray loads into
    # a free cell-tray BAY, not necessarily the drop well's own. Prefer the drop well's own bay
    # (keeps the common case unchanged), else the other free bay; only both-bays-occupied is a
    # genuine collision (see docs/pacbio-sprq-nx-scheduling-reference.md's "Plate vs cell").
    bay_order = [drop_bay] + [b for b in range(bay_count) if b != drop_bay]
    chosen_bay = next((b for b in bay_order if not _bay_blocked(b)), None)
    if chosen_bay is None:
        raise ValueError(
            f"both cell-tray bays on this instrument are occupied by existing physical trays; "
            f"no free bay to load a fresh tray for well {well}."
        )

    lo = chosen_bay * CELLS_PER_TRAY
    box_wells = WELLS[lo : lo + CELLS_PER_TRAY]

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
        # Select the placed cell by tray POSITION, not home_well == well: when the tray lands in
        # the OTHER bay than the drop well, no home_well equals `well`, but the sample still
        # occupies the drop well's position (loaded into `well` - the loading-well != home-well
        # split, already rendered correctly by run_serializer._slot_index).
        if position - 1 == pos:
            placed = cell
        else:
            siblings.append(cell)
    assert placed is not None
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


def last_use_run_date(cell: Cell, uses: list[CellUse] | None = None) -> date | None:
    """The run_date of the cell's most recent active use - the earliest calendar day its
    *next* use could legally start is the following weekday (reuse is always a strictly
    later date, never same-day - see docs/pacbio-sprq-nx-scheduling-reference.md #4)."""
    uses = active_uses(cell) if uses is None else uses
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


def window_hours_elapsed(cell: Cell, at: datetime | None = None) -> float | None:
    if cell.first_use_started_at is None:
        return None
    started = ensure_aware(cell.first_use_started_at)
    return ((at or utcnow()) - started).total_seconds() / 3600


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


def has_barcode_clash(cell_use: CellUse) -> bool:
    """Whether this use shares a burned barcode with another active use of the same cell
    carrying a DIFFERENT Pool ID - a genuine reuse carryover risk. In normal placement
    this can't happen (guarded at place time); it only arises when a Cell QC tray re-zip
    shifts a sample onto a cell that already burned a clashing barcode belonging to a
    different sample (services/qc_service.py), which is exactly what we want to flag.

    Two uses of the identical Pool ID sharing a barcode (see is_duplicate_cell_reuse)
    are deliberately excluded here - that's the same physical material either way, not a
    cross-sample clash, so it must not paint the QC "barcode clash" danger badge."""
    cell = cell_use.cell
    if cell is None:
        return False
    mine = cell_use.barcode_list
    if not mine:
        return False
    my_ext = cell_use.sample.pool_id if cell_use.sample else None
    others = [u for u in active_uses(cell) if u.id != cell_use.id]
    owners = barcode_owners(cell, others)
    return foreign_barcode_clash(owners, my_ext, mine)


def needs_qc_report(cell: Cell) -> bool:
    """True once a cell has a Failed use or is Stopped, until someone raises a PacBio
    case for it - drives the "unreported cells" list."""
    return (cell.status == "stopped" or has_failed_use(cell)) and cell.pacbio_reported_at is None


def awaiting_credit(cell: Cell) -> bool:
    """True once a cell has been reported to PacBio but the credit hasn't physically
    landed in the lab yet - drives the "awaiting credit" list."""
    return cell.pacbio_reported_at is not None and cell.credit_received_at is None


def cell_use_summary(cell: Cell, uses: list[CellUse] | None = None) -> list[CellUseSummaryOut]:
    """Compact, chronological (earliest-first) list of the samples/runs a cell has been
    used by - the linked container/run list on the cell card. Same ordering as the detail
    page's full use history (use_sort_key), so a cell reads the same way in both places."""
    uses = cell.cell_uses if uses is None else uses
    summary: list[CellUseSummaryOut] = []
    for cu in sorted(uses, key=use_sort_key):
        run_batch = cu.cycle.run_batch if cu.cycle else None
        # Same anchor precedence the frontend applies to the cell's first use (actual start once
        # confirmed loaded, else the plate's planned start) but per-use, so each use can be placed
        # on the timeline for the tray map's live breakout count.
        anchor = cu.started_at or (cu.cycle.planned_start_at if cu.cycle else None)
        summary.append(
            CellUseSummaryOut(
                id=cu.id,
                run_batch_id=run_batch.id if run_batch else -1,
                run_name=run_batch.run_name if run_batch else None,
                sample_id=cu.sample_id,
                sample_pool_id=cu.sample.pool_id if cu.sample else None,
                well=cu.well,
                status=cu.status,
                run_started=run_has_started(cu),
                breakout_anchor_at=ensure_aware(anchor) if anchor else None,
            )
        )
    return summary


def _active_uses_as_of(cell: Cell, as_of: datetime) -> list[CellUse]:
    """A cell's active uses that have *happened by* `as_of` - the ones whose acquire day is
    on or before the reference date. Drives the read-only "as of now / as of end of week"
    projection on the Cells page: a use scheduled for later this week doesn't yet count toward
    consumed capacity when viewing "as of now", but does when viewing "as of end of week". A
    date-less use sorts as the distant past (use_run_date -> None -> treated < any date), so it
    always counts - matching use_sort_key's date.min convention."""
    ref = as_of.date()
    return [cu for cu in active_uses(cell) if (use_run_date(cu) or date.min) <= ref]


def serialize_cell(cell: Cell, as_of: datetime | None = None) -> CellOut:
    """Serialize a cell for the API. With `as_of` set, every time-derived field (uses
    consumed/remaining, burned barcodes, current location, use list, window elapsed, and the
    derived status) is projected to that reference instant instead of "now" - a strictly
    READ-ONLY view (it never mutates the cell or clears a persisted window breach). Terminal
    states (retired/stopped/discarded) and a persisted window breach are sticky and always
    shown, so the projection can reveal a *future* exhaustion/expiry but never un-expire a
    cell. `as_of=None` reproduces the persisted-status "now" behaviour exactly."""
    if as_of is None:
        uses_consumed, remaining, burned = derive_cell_state(cell)
        instrument_serial, well = current_location(cell)
        status = cell.status
        elapsed = window_hours_elapsed(cell)
        window_breached = cell.window_breached
        uses = cell_use_summary(cell)
        last_run_date = last_use_run_date(cell)
    else:
        as_of_uses = _active_uses_as_of(cell, as_of)
        uses_consumed, remaining, burned = derive_cell_state(cell, as_of_uses)
        instrument_serial, well = current_location(cell, as_of_uses)
        # The 108h window only "runs" in the projection once the cell has a use by `as_of` -
        # otherwise a cell with no projected uses would show a running window meter, contradicting
        # its "0 uses" reading. (window_hours_elapsed is still anchored to the real confirmed
        # first_use_started_at; this just gates whether we show it at all in the projected view.)
        elapsed = window_hours_elapsed(cell, at=as_of) if as_of_uses else None
        # Monotonic: a persisted breach stays breached; the projection may only add a future one.
        window_breached = cell.window_breached or (elapsed is not None and elapsed > CELL_LIFETIME_H)
        # Terminal states are sticky and time-independent - keep them; otherwise re-derive.
        if cell.status in ("retired", "stopped") or cell.discarded_at is not None:
            status = cell.status
        else:
            status = derive_status(remaining, window_breached)
        uses = cell_use_summary(cell, as_of_uses)
        last_run_date = last_use_run_date(cell, as_of_uses)
    return CellOut(
        id=cell.id,
        code=cell.code,
        max_uses=cell.max_uses,
        status=status,
        uses_consumed=uses_consumed,
        uses_remaining=remaining,
        burned_barcodes=burned,
        window_hours_elapsed=elapsed,
        window_breached=window_breached,
        current_instrument_serial=instrument_serial,
        current_well=well,
        last_use_run_date=last_run_date,
        reuse_ready_at=cell_ready_at(cell),
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
        internal_report_id=cell.internal_report_id,
        internal_report_at=cell.internal_report_at,
        pacbio_case_number=cell.pacbio_case_number,
        pacbio_reported_at=cell.pacbio_reported_at,
        pacbio_credit_confirmed_at=cell.pacbio_credit_confirmed_at,
        credit_acquisitions=cell.credit_acquisitions,
        credit_notes=cell.credit_notes,
        credit_received_at=cell.credit_received_at,
        tray_id=cell.tray_id,
        tray_position=cell.tray_position,
        tray_size=CELLS_PER_TRAY,
        tray_reuse_disabled=cell.tray is not None and cell.tray.reuse_disabled_at is not None,
        uses=uses,
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
                sample_pool_id=cu.sample.pool_id if cu.sample else None,
                sample_priority=cu.sample.priority if cu.sample else None,
                sample_target_oplc=cu.sample.target_oplc if cu.sample else None,
                sample_adaptive_loading=cu.sample.adaptive_loading if cu.sample else None,
                sample_full_resolution_base_q=cu.sample.full_resolution_base_q if cu.sample else None,
                sample_base_kinetics=cu.sample.base_kinetics if cu.sample else None,
                barcodes=cu.barcode_list,
                instrument_serial=(run_batch.instrument.serial_number if run_batch and run_batch.instrument else None),
                started_at=cu.started_at,
                completed_at=cu.completed_at,
                outcome_notes=cu.outcome_notes,
                run_started=run_has_started(cu),
                undo_available=undo_available(cu),
                reassigned=cu.reassigned_from_cell_id is not None,
                barcode_clash=has_barcode_clash(cu),
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


def set_tray_reuse_disabled(db: Session, tray: CellTray, disabled: bool, actor: str | None) -> CellTray:
    """Toggle a physical tray's reversible "skip reuse / planning disposal" flag. When on,
    load_prior_cells drops every cell in the tray from the reuse pool, so autoschedule and
    Recalculate stop offering it - the lab intends to bin the whole tray. Advisory and
    non-terminal: unlike discard_tray it never touches cell status or cancels uses, and
    turning it off re-admits the tray to reuse. Whole-tray by construction (the flag lives
    on CellTray); a single cell only leaves service on its own via a QC stop. Caller-safe
    to call redundantly. Commits."""
    tray.reuse_disabled_at = utcnow() if disabled else None
    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="tray_skip_reuse" if disabled else "tray_resume_reuse",
            entity_type="cell_tray",
            entity_id=tray.id,
            details_json={"disabled": disabled},
        )
    )
    db.commit()
    db.refresh(tray)
    return tray


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


def set_cell_internal_report(db: Session, cell: Cell, report_id: str, actor: str | None) -> Cell:
    """Record the lab's internal report of a cell failure - the report ID it's filed under
    (e.g. 26_NC_S_004). Stamps internal_report_at the first time an ID is saved (that
    completes the stage); later edits update the ID but keep the original raised-at time."""
    if cell.status != "stopped" and not has_failed_use(cell):
        raise ValueError("Cell has no failed or stopped use to report internally.")
    cell.internal_report_id = report_id
    if cell.internal_report_at is None:
        cell.internal_report_at = utcnow()
    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="set_cell_internal_report",
            entity_type="cell",
            entity_id=cell.id,
            details_json={"report_id": report_id},
        )
    )
    db.commit()
    db.refresh(cell)
    return cell


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


def set_cell_credit_notes(db: Session, cell: Cell, notes: str | None, actor: str | None) -> Cell:
    """Set the free-text note on a credit case. Editable at any stage of the workflow (from
    failure through credit received), so it's not tied to any one step's timestamp."""
    if cell.status != "stopped" and not has_failed_use(cell):
        raise ValueError("Cell has no failed or stopped use to note against.")
    cell.credit_notes = (notes or "").strip() or None
    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="set_cell_credit_notes",
            entity_type="cell",
            entity_id=cell.id,
            details_json={"notes": cell.credit_notes},
        )
    )
    db.commit()
    db.refresh(cell)
    return cell


def confirm_cell_credit(db: Session, cell: Cell, acquisitions: int, actor: str | None) -> Cell:
    if cell.pacbio_case_number is None:
        raise ValueError("Cell has not been reported to PacBio yet.")
    if acquisitions < 1:
        raise ValueError("Credited acquisitions must be a positive number.")
    cell.credit_acquisitions = acquisitions
    cell.pacbio_credit_confirmed_at = utcnow()
    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="confirm_cell_credit",
            entity_type="cell",
            entity_id=cell.id,
            details_json={"acquisitions": acquisitions},
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
