"""A run's results as MLWH recorded them, well by well, beside RunNx's plan - and where the two
disagree. Shown on the run's page and in the slot popover; the run's SMRT Link link comes from here
too. Nothing is copied into RunNx: it's read from MLWH (through mlwh_wells' cache) on request.

The disagreements are flags that warn and never block (the app's convention for every manual
path): the pool in the well, the movie length, the use number, the physical SMRT cell, and a cell
MLWH recorded where RunNx planned nothing. The loading concentration is shown beside the plan but
not flagged - what counts as "too far off" is a lab judgement, not a fact.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.schedule import CellUse, Cycle, RunBatch
from app.schemas.sequencing import MlwhWellFactsOut, RunSequencingOut, RunSequencingWellOut, SequencingFlagOut
from app.services import mlwh, mlwh_wells
from app.services.mlwh_wells import (
    UNNAMED_RUN_MAX_LEAD_DAYS,
    MlwhWell,
    RunIndex,
    chunks,
    load_runs,
    run_key,
    smrt_link_url,
)
from app.services.run_serializer import _use_number

# A run still going is re-read from MLWH at most this often; one whose every well has finished
# and has a LangQC verdict won't change, so it's kept longer.
_LIVE_TTL_S = 60
_FINAL_TTL_S = 600
# The SMRT Link movie may differ from the planned run time by this much before it's flagged.
MOVIE_TOLERANCE_MIN = 30


@dataclass(frozen=True)
class Planned:
    """What RunNx planned for one well - all reconcile() needs to know."""

    pool_id: str | None
    run_time_hours: int | None
    use_number: int | None
    cell_code: str | None
    # MLWH's SMRT cell id on this cell's other uses: (Use N, run label, SMRT cell id).
    other_uses: tuple[tuple[int, str, str], ...] = ()


def _hours(minutes: float) -> str:
    return f"{minutes / 60:g} h"


def reconcile(planned: Planned | None, well: MlwhWell | None) -> list[SequencingFlagOut]:
    """Where MLWH's record of a well disagrees with RunNx's plan."""
    if well is None:
        return []
    if planned is None:
        return [
            SequencingFlagOut(
                kind="not_in_plan",
                label="Not in RunNx",
                detail="SMRT Link recorded a cell in this well, but RunNx has nothing planned here.",
            )
        ]
    flags: list[SequencingFlagOut] = []
    barcodes = {b.upper() for b in well.library_barcodes}
    if planned.pool_id and barcodes and planned.pool_id.strip().upper() not in barcodes:
        flags.append(
            SequencingFlagOut(
                kind="pool_differs",
                label="Pool ID differs",
                detail=f"RunNx has {planned.pool_id} in this well, but MLWH loaded "
                f"{', '.join(well.library_barcodes)} - check it's the right well.",
            )
        )
    if (
        planned.run_time_hours
        and well.movie_minutes is not None
        and abs(well.movie_minutes - planned.run_time_hours * 60) > MOVIE_TOLERANCE_MIN
    ):
        flags.append(
            SequencingFlagOut(
                kind="movie_differs",
                label="Movie differs",
                detail=f"Planned {planned.run_time_hours} h; SMRT Link ran {_hours(well.movie_minutes)}.",
            )
        )
    if planned.use_number and well.cell_use_count is not None and well.cell_use_count != planned.use_number:
        flags.append(
            SequencingFlagOut(
                kind="use_differs",
                label="Use differs",
                detail=f"RunNx planned Use {planned.use_number} of {planned.cell_code or 'this cell'}; "
                f"SMRT Link recorded Use {well.cell_use_count}.",
            )
        )
    if well.smrt_cell_id:
        other = next((o for o in planned.other_uses if o[2] and o[2] != well.smrt_cell_id), None)
        if other is not None:
            use_n, run_label, cell_id = other
            flags.append(
                SequencingFlagOut(
                    kind="cell_differs",
                    label="Different SMRT cell",
                    detail=f"RunNx has one cell ({planned.cell_code or 'this cell'}) on Use {use_n} and here, "
                    f"but SMRT Link read cell {cell_id} on Use {use_n} ({run_label}) and "
                    f"{well.smrt_cell_id} here - check the tray.",
                )
            )
    return flags


def facts_out(well: MlwhWell) -> MlwhWellFactsOut:
    return MlwhWellFactsOut(
        qc_state=well.qc_state or None,
        qc_date=well.qc_date,
        well_start=well.well_start,
        well_complete=well.well_complete,
        run_status=well.run_status,
        well_status=well.well_status,
        smrt_cell_id=well.smrt_cell_id,
        cell_lot=well.cell_lot,
        cell_use_count=well.cell_use_count,
        is_multi_use=well.is_multi_use,
        sequencing_kit=well.sequencing_kit,
        movie_name=well.movie_name,
        movie_minutes=well.movie_minutes,
        loading_conc=well.loading_conc,
        hifi_yield_gb=well.hifi_yield_gb,
        hifi_read_length_kb=round(well.hifi_read_length_mean / 1000, 1) if well.hifi_read_length_mean is not None else None,
        p1_pct=well.p1_pct,
        library_barcodes=well.library_barcodes,
        sample_count=well.sample_count,
    )


def _letter(well: str) -> str:
    return well[:1].upper()


def _related_run_names(db: Session, run_id: int) -> list[str]:
    """The Traction run names of every run this run's cells were used on (itself included), so
    one MLWH read covers the cell-identity check too."""
    cells_here = select(CellUse.cell_id).join(Cycle, CellUse.cycle_id == Cycle.id).where(Cycle.run_batch_id == run_id)
    stmt = (
        select(RunBatch.run_name)
        .join(Cycle, Cycle.run_batch_id == RunBatch.id)
        .join(CellUse, CellUse.cycle_id == Cycle.id)
        .where(CellUse.cell_id.in_(cells_here), RunBatch.run_name.is_not(None))
        .distinct()
    )
    return sorted({k for k in (run_key(n) for n in db.scalars(stmt)) if k})


def build_run_sequencing(db: Session, run_id: int, *, refresh: bool = False) -> RunSequencingOut | None:
    """The run's wells as MLWH recorded them, matched to its uses and flagged where they disagree.
    None when RunNx has no such run. Never raises for MLWH trouble."""
    run = db.get(RunBatch, run_id)
    if run is None:
        return None
    out = RunSequencingOut(configured=mlwh.is_configured())
    if not out.configured:
        return out

    name = run_key(run.run_name)
    serial = run.instrument.serial_number if run.instrument else None
    load_date = run.load_date
    names = _related_run_names(db, run_id)
    if name and name not in names:
        names = sorted([*names, name])
    db.rollback()  # hand RunNx's connection back while MLWH is asked (see mlwh_wells)

    window_end = load_date + timedelta(days=UNNAMED_RUN_MAX_LEAD_DAYS + 1)

    def read(engine) -> list[MlwhWell]:
        wells: list[MlwhWell] = []
        for chunk in chunks(names):
            wells += mlwh_wells.fetch_wells(
                engine, "m.pac_bio_run_name IN :names", {"names": chunk}, expanding=("names",)
            )
        if name is None and serial:
            # No Traction name: this instrument's wells that started within the load window.
            wells += mlwh_wells.fetch_wells(
                engine,
                "m.instrument_name = :instrument AND m.well_start >= :start AND m.well_start < :end",
                {"instrument": serial, "start": f"{load_date} 00:00:00", "end": f"{window_end} 00:00:00"},
            )
        return wells

    def ttl(wells: list[MlwhWell]) -> float:
        mine = [w for w in wells if name and run_key(w.run_name) == name]
        return _FINAL_TTL_S if mine and all(w.qc_state and w.well_complete for w in mine) else _LIVE_TTL_S

    try:
        wells = mlwh_wells.fetch(("run_sequencing", run_id, name, tuple(names)), read, ttl=ttl, refresh=refresh)
    except mlwh_wells.MlwhUnavailable as exc:
        out.error = str(exc)
        return out
    out.ok = True

    run = db.get(RunBatch, run_id, options=mlwh_wells.RUN_OPTIONS, populate_existing=True)
    if run is None:  # deleted while MLWH was asked
        return None

    if name:
        mine = [w for w in wells if run_key(w.run_name) == name]
        out.matched_by = "run_name" if mine else None
    else:
        lead = timedelta(days=UNNAMED_RUN_MAX_LEAD_DAYS)
        index = RunIndex(load_runs(db, load_date - lead, instrument_serial=serial, latest=window_end))
        mine = []
        for w in wells:
            found = index.match(w)
            if found is not None and found[0].id == run_id:
                mine.append(w)
        out.matched_by = "instrument_date" if mine else None

    by_place = {(w.plate_number, _letter(w.well_label)): w for w in mine}
    elsewhere = {(run_key(w.run_name), w.plate_number, _letter(w.well_label)): w for w in wells}
    out.mlwh_run_name = mine[0].run_name if mine else None
    out.smrt_link_url = next((url for url in (smrt_link_url(w) for w in mine) if url), None)

    used: set[tuple[int, str]] = set()
    rows: list[RunSequencingWellOut] = []
    for cycle in sorted(run.cycles, key=lambda c: c.plate_index):
        for cu in sorted(cycle.cell_uses, key=lambda u: u.well):
            if cu.status == "cancelled":
                continue  # a Stop-cell "Blocked" marker, not something that loaded
            place = (cycle.plate_index, _letter(cu.well))
            well = by_place.get(place) if place not in used else None
            if well is not None:
                used.add(place)
            sample = cu.sample
            planned = Planned(
                pool_id=sample.pool_id if sample else None,
                run_time_hours=cu.run_time_hours,
                use_number=_use_number(cu),
                cell_code=cu.cell.code if cu.cell else None,
                other_uses=_other_uses(cu, run, by_place, elsewhere),
            )
            rows.append(
                RunSequencingWellOut(
                    key=well.key if well else f"runnx:{cu.id}",
                    plate_number=cycle.plate_index,
                    well=cu.well,
                    cell_use_id=cu.id,
                    cell_id=cu.cell_id,
                    cell_code=planned.cell_code,
                    use_number=planned.use_number,
                    sample_id=cu.sample_id,
                    pool_id=planned.pool_id,
                    planned_hours=cu.run_time_hours,
                    planned_oplc=(sample.actual_oplc if sample.actual_oplc is not None else sample.target_oplc)
                    if sample
                    else None,
                    mlwh=facts_out(well) if well else None,
                    flags=reconcile(planned, well),
                )
            )
    for place, well in by_place.items():
        if place not in used:
            rows.append(
                RunSequencingWellOut(
                    key=well.key, plate_number=well.plate_number, well=well.well_label,
                    mlwh=facts_out(well), flags=reconcile(None, well),
                )
            )
    rows.sort(key=lambda r: (r.plate_number, _letter(r.well), r.well))
    out.wells = rows
    return out


def _other_uses(
    cu: CellUse,
    run: RunBatch,
    by_place: dict[tuple[int, str], MlwhWell],
    elsewhere: dict[tuple[str | None, int, str], MlwhWell],
) -> tuple[tuple[int, str, str], ...]:
    """MLWH's SMRT cell id on each of this cell's OTHER uses that MLWH has recorded."""
    if cu.cell is None:
        return ()
    found: list[tuple[int, str, str]] = []
    for other in cu.cell.cell_uses:
        if other.id == cu.id or other.status == "cancelled":
            continue
        other_run = other.cycle.run_batch
        place = (other.cycle.plate_index, _letter(other.well))
        well = by_place.get(place) if other_run.id == run.id else elsewhere.get((run_key(other_run.run_name), *place))
        if well is not None and well.smrt_cell_id:
            found.append((_use_number(other), other_run.run_name or f"Run #{other_run.id}", well.smrt_cell_id))
    return tuple(found)
