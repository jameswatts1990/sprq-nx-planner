"""The Stats page's reuse tiles: HiFi yield and P1 loading by Use 1/2/3 of a SMRT cell, from MLWH,
for the RunNx runs loading in range - "does running a cell a second and third time cost us
yield?". Kept apart from stats_service.compute_stats so the main Stats figures stay fast and never
depend on MLWH; the page asks for these separately and fills them in after.

A well counts under RunNx's own Use number for it (the plan the lab scheduled), not MLWH's - the
run page flags where those disagree. Only runs with a Traction run name can be matched, so the
response says how many of the range's runs that is. A well with no yield, or on a run SMRT Link
aborted or terminated, is left out: it says nothing about reuse.
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date
from statistics import median

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.instrument import Instrument
from app.models.schedule import RunBatch
from app.schemas.sequencing import SequencingStatsOut, UseOutcomeOut
from app.services import mlwh, mlwh_wells
from app.services.mlwh_wells import MlwhWell, chunks, run_key, use_at
from app.services.run_serializer import _use_number

_TTL_S = 600
_DEAD_RUN = re.compile(r"abort|terminat", re.IGNORECASE)


def _counts(well: MlwhWell) -> bool:
    if not well.hifi_read_bases:
        return False
    return not any(s and _DEAD_RUN.search(s) for s in (well.run_status, well.well_status))


def build_sequencing_stats(
    db: Session,
    date_from: date | None,
    date_to: date | None,
    instrument_serial: str | None,
    *,
    refresh: bool = False,
) -> SequencingStatsOut:
    out = SequencingStatsOut(configured=mlwh.is_configured())
    if not out.configured:
        return out

    stmt = select(RunBatch.id, RunBatch.run_name)
    if date_from:
        stmt = stmt.where(RunBatch.load_date >= date_from)
    if date_to:
        stmt = stmt.where(RunBatch.load_date <= date_to)
    if instrument_serial:
        stmt = stmt.join(RunBatch.instrument).where(Instrument.serial_number == instrument_serial)
    runs = db.execute(stmt).all()
    out.runs_total = len(runs)
    ids_by_key: dict[str, int] = {}
    for run_id, name in runs:
        key = run_key(name)
        if key:
            ids_by_key.setdefault(key, run_id)
    out.runs_named = len(ids_by_key)
    names = sorted(ids_by_key)
    db.rollback()  # hand RunNx's connection back while MLWH is asked (see mlwh_wells)

    def read(engine) -> list[MlwhWell]:
        wells: list[MlwhWell] = []
        for chunk in chunks(names):
            wells += mlwh_wells.fetch_wells(engine, "m.pac_bio_run_name IN :names", {"names": chunk}, expanding=("names",))
        return wells

    try:
        wells = mlwh_wells.fetch(("sequencing_stats", tuple(names)), read, ttl=_TTL_S, refresh=refresh) if names else []
    except mlwh_wells.MlwhUnavailable as exc:
        out.error = str(exc)
        return out
    out.ok = True

    counted = [w for w in wells if _counts(w)]
    wanted = sorted({ids_by_key[k] for k in (run_key(w.run_name) for w in counted) if k in ids_by_key})
    loaded: dict[int, RunBatch] = {}
    for chunk in chunks(wanted):
        for run in db.scalars(select(RunBatch).where(RunBatch.id.in_(chunk)).options(*mlwh_wells.RUN_OPTIONS)):
            loaded[run.id] = run

    yields: dict[int, list[float]] = defaultdict(list)
    p1s: dict[int, list[float]] = defaultdict(list)
    cells: dict[int, int] = defaultdict(int)
    for well in counted:
        run = loaded.get(ids_by_key.get(run_key(well.run_name) or "", -1))
        use = use_at(run, well.plate_number, well.well_label) if run else None
        if use is None:
            continue
        n = _use_number(use)
        cells[n] += 1
        yields[n].append(well.hifi_read_bases / 1e9)
        if well.p1_pct is not None:
            p1s[n].append(well.p1_pct)

    out.by_use = [
        UseOutcomeOut(
            use=n,
            cells=cells[n],
            median_hifi_gb=round(median(yields[n]), 1) if yields[n] else None,
            median_p1_pct=round(median(p1s[n]), 1) if p1s[n] else None,
        )
        for n in (1, 2, 3)
    ]
    return out
