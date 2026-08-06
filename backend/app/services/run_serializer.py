"""Serializes a persisted RunBatch (one run) into the RunOut shape the frontend grid
renders: a run with 1-2 plates (its Cycles), each plate holding its wells (stages).

Was schedule_service.py -> the flat per-cycle cycle_out; the Run->Plate split means a run
is a RunBatch (load_date) and a plate is a Cycle (acquire_date), so we serialize the run
and nest its plates.
"""
from __future__ import annotations


from sqlalchemy.orm import Session, selectinload

from app.engine.constants import CELLS_PER_TRAY, within_tray_pos
from app.models.cell import Cell
from app.models.schedule import CellUse, Cycle, RunBatch
from app.schemas.run import PlateOut, RunOut, StageOut
from app.serializers import duplicate_groups
from app.services.cell_service import (
    has_barcode_clash,
    has_failed_use,
    is_duplicate_cell_reuse,
    reuse_not_ready_hours,
    use_sort_key,
    window_hours_elapsed,
)
from app.services.cell_timing import coarse_movie_end, run_is_acquiring, run_load_at
from app.services.instrument_lock import effective_run_start, run_lock_until
from app.timeutil import ensure_aware, utcnow

# The eager-load set every run_out caller must use. From the run's cycles (plates) down to
# each stage's cell/sample/barcodes, plus each stage's cell's *full* sibling-use list and
# each sibling's cycle/sample: _use_number() sorts a cell's uses by acquire_date (via
# use_run_date -> cycle.acquire_date), has_failed_use() scans the cell's use statuses, and
# has_barcode_clash()/is_duplicate_cell_reuse() need each sibling's own Sample.external_id to
# tell a genuine cross-sample barcode clash apart from another copy of the same duplicate
# Container ID. Without the Cell.cell_uses chain, each of these lazy-loads per stage, turning
# one grid fetch into an N+1.
RUN_LOAD_OPTIONS = [
    selectinload(RunBatch.instrument),
    selectinload(RunBatch.cycles)
    .selectinload(Cycle.cell_uses)
    .selectinload(CellUse.cell)
    .selectinload(Cell.cell_uses)
    .selectinload(CellUse.cycle),
    selectinload(RunBatch.cycles)
    .selectinload(Cycle.cell_uses)
    .selectinload(CellUse.cell)
    .selectinload(Cell.cell_uses)
    .selectinload(CellUse.sample),
    selectinload(RunBatch.cycles).selectinload(Cycle.cell_uses).selectinload(CellUse.sample),
    selectinload(RunBatch.cycles).selectinload(Cycle.cell_uses).selectinload(CellUse.barcodes),
]


def _use_number(cell_use: CellUse) -> int:
    """1-based position of this cell_use among all of its cell's loads, in true
    chronological (acquire_date) order - what the Use 1/2/3 grid colour/legend refers to.
    Grouping by cell here (rather than by well/slot_index) is what lets a reused cell's
    wells share a colour. CellUse.id is only a tie-break, not the primary key: a batch
    auto-fill spanning multiple instruments can commit rows in an order that doesn't
    match any one cell's own date sequence (see auto_fill_service.py's persist loop)."""
    cell = cell_use.cell
    if cell is None:
        return 1
    ordered = sorted(cell.cell_uses, key=use_sort_key)
    return ordered.index(cell_use) + 1


def _slot_index(plate_index: int, well: str) -> int:
    """Grid position 0-7 for a well within a run: (plate - 1) * 4 + the well's letter index
    (A/B/C/D -> 0-3). Derived from the plate rather than WELLS.index(well) so a reuse Plate 2
    - whose wells are the same A01-D01 as Plate 1 - lands in the Plate 2 block (4-7), not on
    top of Plate 1."""
    return (plate_index - 1) * CELLS_PER_TRAY + within_tray_pos(well)


def _stage_out(
    cell_use: CellUse,
    plate_index: int,
    dup_groups: dict[str, list[int]] | None = None,
    *,
    with_reuse_timing: bool = False,
) -> StageOut:
    dup_index = dup_total = None
    if dup_groups is not None and cell_use.sample is not None:
        group = dup_groups.get(cell_use.sample.external_id)
        if group and len(group) > 1 and cell_use.sample_id in group:
            dup_index, dup_total = group.index(cell_use.sample_id) + 1, len(group)
    return StageOut(
        slot_index=_slot_index(plate_index, cell_use.well),
        well=cell_use.well,
        cell_use_id=cell_use.id,
        cell_id=cell_use.cell_id,
        cell_ref=cell_use.cell.code if cell_use.cell else "?",
        cell_home_well=cell_use.cell.home_well if cell_use.cell else None,
        use_number=_use_number(cell_use),
        cell_max_uses=cell_use.cell.max_uses if cell_use.cell else 3,
        run_time_hours=cell_use.run_time_hours,
        sample_id=cell_use.sample_id,
        sample_external_id=cell_use.sample.external_id if cell_use.sample else None,
        insert_size_bp=cell_use.sample.insert_size_bp if cell_use.sample else None,
        duplicate_index=dup_index,
        duplicate_total=dup_total,
        duplicate_cell_reuse=is_duplicate_cell_reuse(cell_use),
        barcodes=cell_use.barcode_list,
        cell_use_status=cell_use.status,
        cell_status=cell_use.cell.status if cell_use.cell else "open",
        cell_has_failed_use=has_failed_use(cell_use.cell) if cell_use.cell else False,
        tray_position=cell_use.cell.tray_position if cell_use.cell else None,
        tray_id=cell_use.cell.tray_id if cell_use.cell else None,
        window_hours_elapsed=window_hours_elapsed(cell_use.cell) if cell_use.cell else None,
        # Advisory only, and only computed on placement/move/auto-fill responses
        # (with_reuse_timing, same gate as effective_start_at below) - a non-first use's real
        # readiness check needs its prior use's own cross-run timing, which isn't in the grid
        # feed's eager-load set and would otherwise turn every grid fetch into a per-cell N+1.
        reuse_not_ready_hours=reuse_not_ready_hours(cell_use) if with_reuse_timing and cell_use.cell else None,
        notes=cell_use.notes,
        reassigned=cell_use.reassigned_from_cell_id is not None,
        barcode_clash=has_barcode_clash(cell_use),
    )


def _plate_out(
    run_batch: RunBatch,
    cycle: Cycle,
    dup_groups: dict[str, list[int]] | None = None,
    *,
    with_reuse_timing: bool = False,
) -> PlateOut:
    live = [cu for cu in cycle.cell_uses if cu.status != "cancelled"]
    # Prep-aware plate movie-end from the ONE timing model (coarse_movie_end: load + prep + movie,
    # +the on-board wash for a reuse plate) - the movie can't start until the cell is prepped.
    # Derived on read so it always reflects the current model; the stored cycle.planned_end_at is
    # the older prep-blind value, kept only as a fallback for a plate with no live wells.
    planned_end_at = (
        coarse_movie_end(
            cycle.planned_start_at, cycle.movie_hours, is_reuse=any(_use_number(cu) >= 2 for cu in live)
        )
        if live
        else ensure_aware(cycle.planned_end_at)
    )
    return PlateOut(
        plate_id=cycle.id,
        plate_index=cycle.plate_index,
        acquire_date=cycle.acquire_date,
        # A plate reuses Plate 1's cells iff it acquires later than the run's load day; a
        # fresh parallel Plate 2 acquires on the load day, same as Plate 1.
        is_reuse=cycle.acquire_date > run_batch.load_date,
        movie_hours=cycle.movie_hours,
        status=cycle.status,
        # Coerce to UTC-aware so these serialize with a 'Z' (like lock_until), consistent
        # regardless of backend: SQLite drops tzinfo on round-trip, which would otherwise
        # emit a naive ISO string the frontend reads as *local* time (off by the viewer's
        # UTC offset). Every value written here is UTC (see planned_window / reuse_plate_window).
        planned_start_at=ensure_aware(cycle.planned_start_at),
        planned_end_at=planned_end_at,
        actual_start_at=ensure_aware(cycle.actual_start_at) if cycle.actual_start_at else None,
        actual_end_at=ensure_aware(cycle.actual_end_at) if cycle.actual_end_at else None,
        stages=[
            _stage_out(cu, cycle.plate_index, dup_groups, with_reuse_timing=with_reuse_timing)
            for cu in sorted(cycle.cell_uses, key=lambda x: x.well)
        ],
    )


def _run_status(cycles: list[Cycle]) -> str:
    """Run-level status derived from its plates. The plates are all loaded in one session,
    so the run reads as running once any plate is, and completed only once all plates are
    terminal."""
    statuses = [c.status for c in cycles]
    if any(s == "running" for s in statuses):
        return "running"
    if statuses and all(s in ("completed", "aborted") for s in statuses):
        return "completed" if any(s == "completed" for s in statuses) else "aborted"
    return "planned"


def run_out(db: Session, run_batch: RunBatch, *, with_effective_start: bool = False) -> RunOut:
    """Serialize a run. Pass ``with_effective_start=True`` on placement/move/auto-fill responses to
    attach the lane-model effective start (when the run's cells really break out given the machine's
    other resident runs) - kept OFF the grid feed by default, as it needs a per-run resident-set
    query we don't want to fire for every grid row. Same flag also gates each stage's
    ``reuse_not_ready_hours`` (StageOut) - a non-first use's prior-use timing isn't in the grid
    feed's eager-load set either, same per-row-query concern."""
    instrument = run_batch.instrument
    serial = instrument.serial_number if instrument else "?"
    # Drop any orphaned EMPTY cycle (no cell_uses at all): nothing is loaded, so it must not
    # render as a plate or project an instrument lock/continuation. Such a cycle should never
    # exist (get_or_create_run always adds a use immediately), but a partial or racy bulk
    # removal could historically leave one behind - and it would then keep marking neighbouring
    # days "locked" long after a Clear wiped every sample (reported by the lab owner: a lock
    # left on Tue+Wed with nothing on Mon). A cancelled-only cycle keeps its cell_uses and is
    # unaffected. The atomic bulk-remove path (placement_service.remove_samples) now prevents
    # new orphans; this guard also neutralises any already in the DB.
    cycles = sorted((c for c in run_batch.cycles if c.cell_uses), key=lambda c: c.plate_index)

    # Duplicate-marker groups for every sample placed in this run, in one query (see
    # serializers.duplicate_groups) — spans ALL statuses so "1/3" stays stable as siblings
    # get scheduled off the backlog or complete.
    ext_ids = {
        cu.sample.external_id
        for c in cycles
        for cu in c.cell_uses
        if cu.sample is not None
    }
    dup_groups = duplicate_groups(db, ext_ids)

    plates = [_plate_out(run_batch, c, dup_groups, with_reuse_timing=with_effective_start) for c in cycles]
    status = _run_status(cycles)

    now = utcnow()
    if cycles:
        # Two different windows, deliberately: `lock_until` is the short LOADING-lock (gates when
        # the NEXT run can load; drives grid continuation), while `is_locked` means this run is
        # physically ACQUIRING now (some cell prepping / sequencing / in PPA) across its full
        # ~30h+ load->last-PPA span - what "Active now" and the instrument live-gantts key off.
        # Deriving is_locked from lock_until made a mid-sequencing run read as idle a few hours in
        # (see cell_timing.run_is_acquiring / run_acquisition_end).
        lock_until = run_lock_until(db, run_batch, cycles=cycles)
        is_locked = status not in ("aborted", "completed") and run_is_acquiring(run_batch, now)
    else:
        lock_until = now  # empty run: nothing loaded -> no lock, never a continuation
        is_locked = False

    effective_start_at = None
    starts_later_than_requested = False
    if with_effective_start and cycles:
        eff = effective_run_start(db, run_batch)
        load_at = run_load_at(run_batch)
        if eff is not None and load_at is not None:
            effective_start_at = eff
            # > ~1 min later than the chosen load counts as "queues" (guards float/rounding noise).
            starts_later_than_requested = (eff - load_at).total_seconds() > 60

    return RunOut(
        run_id=run_batch.id,
        instrument_serial=serial,
        load_date=run_batch.load_date,
        run_name=run_batch.run_name,
        status=status,
        lock_until=lock_until,
        is_locked=is_locked,
        effective_start_at=effective_start_at,
        starts_later_than_requested=starts_later_than_requested,
        plates=plates,
    )
