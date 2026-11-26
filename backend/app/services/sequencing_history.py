"""A sample's sequencing history from MLWH, Top Up Helper-style: every SMRT cell its library tube
was loaded on, at what concentration, what it got out of the cell and - for a pool - how the
cell's yield split between its members. Mostly for top-ups: how much a sample has had, and what
loading and share it got last time. Read from MLWH (through mlwh_wells' cache) on request.

A loading is found two ways:
- by the sample's Pool ID, which is the library tube's barcode in MLWH;
- by any of its Sanger IDs, which also finds the sample sequenced earlier under ANOTHER tube (a
  top-up often comes back as a new pool). Those loadings are marked via_other_tube, and what
  counts for this sample there is its own members' share, not the whole tube's.

A pooled tube carries one MLWH row per member, so rows are read at product grain and collapsed
here (never GROUP_CONCAT). The member split follows the pacbio-dashboard: a member under 85% of
an even share of its pool is "below even".
"""
from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import Engine, bindparam, select, text
from sqlalchemy.orm import Session

from app.models.sample import Sample
from app.schemas.sequencing import (
    SequencingHistoryOut,
    SequencingLoadingOut,
    SequencingMemberOut,
    SequencingSummariesOut,
    SequencingSummaryOut,
)
from app.services import mlwh, mlwh_wells
from app.services.mlwh_wells import MlwhWell, chunks, run_ids_by_key, run_key, smrt_link_url

_TTL_S = 300
# A pool member under this share of an even split is "below even".
BELOW_EVEN = 0.85

_WELLS_BY_TUBE = text(
    """
    SELECT DISTINCT p.id_pac_bio_rw_metrics_tmp AS well_pk
    FROM pac_bio_product_metrics p
    JOIN pac_bio_run r ON r.id_pac_bio_tmp = p.id_pac_bio_tmp
    WHERE r.pac_bio_library_tube_barcode IN :keys
    """
).bindparams(bindparam("keys", expanding=True))

_WELLS_BY_SANGER_ID = text(
    """
    SELECT DISTINCT p.id_pac_bio_rw_metrics_tmp AS well_pk
    FROM pac_bio_product_metrics p
    JOIN pac_bio_run r ON r.id_pac_bio_tmp = p.id_pac_bio_tmp
    JOIN sample s ON s.id_sample_tmp = r.id_sample_tmp
    WHERE s.sanger_sample_id IN :keys
    """
).bindparams(bindparam("keys", expanding=True))

# Every product (one per tube member) in the wells found - what each member got out of the cell.
_PRODUCTS = text(
    """
    SELECT p.id_pac_bio_rw_metrics_tmp AS well_pk,
           r.pac_bio_library_tube_barcode AS tube,
           s.sanger_sample_id             AS sanger_id,
           p.hifi_read_bases              AS bases,
           p.hifi_bases_percent           AS pct
    FROM pac_bio_product_metrics p
    JOIN pac_bio_run r ON r.id_pac_bio_tmp = p.id_pac_bio_tmp
    LEFT JOIN sample s ON s.id_sample_tmp = r.id_sample_tmp
    WHERE p.id_pac_bio_rw_metrics_tmp IN :pks
    """
).bindparams(bindparam("pks", expanding=True))


@dataclass(frozen=True)
class _Product:
    well_pk: int
    tube: str
    sanger_id: str | None
    bases: float | None
    pct: float | None


@dataclass(frozen=True)
class SampleKeys:
    """What identifies a RunNx sample in MLWH."""

    sample_id: int
    pool_id: str
    sanger_ids: tuple[str, ...]


def _variants(values: Iterable[str]) -> list[str]:
    """Each value as typed and upper-cased: MySQL compares case-insensitively, but not everywhere."""
    out: set[str] = set()
    for v in values:
        v = (v or "").strip()
        if v:
            out |= {v, v.upper()}
    return sorted(out)


def _read(engine: Engine, tubes: list[str], sanger_ids: list[str]) -> tuple[list[_Product], dict[int, MlwhWell]]:
    """The products and wells behind any loading of these tubes or Sanger IDs. Raises on failure."""
    pks: set[int] = set()
    with engine.connect() as conn:
        for keys in chunks(tubes):
            pks |= {row[0] for row in conn.execute(_WELLS_BY_TUBE, {"keys": keys})}
        for keys in chunks(sanger_ids):
            pks |= {row[0] for row in conn.execute(_WELLS_BY_SANGER_ID, {"keys": keys})}
    if not pks:
        return [], {}
    wells: dict[int, MlwhWell] = {}
    for chunk in chunks(sorted(pks)):
        for w in mlwh_wells.fetch_wells(engine, "m.id_pac_bio_rw_metrics_tmp IN :pks", {"pks": chunk}, expanding=("pks",)):
            wells[w.well_pk] = w  # Sequel wells are already left out
    products: list[_Product] = []
    with engine.connect() as conn:
        for chunk in chunks(sorted(wells)):
            for row in conn.execute(_PRODUCTS, {"pks": chunk}).mappings():
                tube = mlwh_wells.clean_str(row["tube"])
                if tube:
                    products.append(
                        _Product(
                            well_pk=row["well_pk"],
                            tube=tube,
                            sanger_id=mlwh_wells.clean_str(row["sanger_id"]),
                            bases=mlwh_wells.as_float(row["bases"]),
                            pct=mlwh_wells.as_float(row["pct"]),
                        )
                    )
    return products, wells


def _gb(bases: float | None) -> float | None:
    return round(bases / 1e9, 2) if bases is not None else None


@dataclass
class _Loading:
    out: SequencingLoadingOut
    sort_key: tuple
    own_bases: float | None
    own_pct: float | None
    well: MlwhWell


def _loadings_for(
    keys: SampleKeys,
    groups: dict[tuple[int, str], list[_Product]],
    wells: dict[int, MlwhWell],
    run_ids: dict[str, int],
) -> list[_Loading]:
    pool = keys.pool_id.strip().upper()
    sangers = {s.strip().upper() for s in keys.sanger_ids if s and s.strip()}
    found: list[_Loading] = []
    for (pk, tube), prods in groups.items():
        well = wells.get(pk)
        if well is None:
            continue
        direct = tube.upper() == pool
        mine = [p for p in prods if p.sanger_id and p.sanger_id.upper() in sangers]
        if not direct and not mine:
            continue
        tube_bases = sum(p.bases for p in prods if p.bases is not None) if any(p.bases is not None for p in prods) else None
        if any(p.pct is not None for p in prods):
            tube_pct = round(sum(p.pct for p in prods if p.pct is not None), 1)
        elif tube_bases is not None and well.hifi_read_bases:
            tube_pct = round(tube_bases / well.hifi_read_bases * 100, 1)
        else:
            tube_pct = None
        plex = len(prods)
        even = tube_bases / plex if tube_bases and plex > 1 else None
        members = [
            SequencingMemberOut(
                sanger_sample_id=p.sanger_id,
                hifi_gb=_gb(p.bases),
                pct_of_cell=round(p.pct, 2) if p.pct is not None else None,
                below_even=bool(even and p.bases is not None and p.bases < BELOW_EVEN * even),
                mine=bool(p.sanger_id and p.sanger_id.upper() in sangers),
            )
            for p in sorted(prods, key=lambda p: -(p.bases or 0))
        ] if plex > 1 else []
        if direct:
            own_bases, own_pct = tube_bases, tube_pct
        else:
            own_bases = sum(p.bases for p in mine if p.bases is not None) if any(p.bases is not None for p in mine) else None
            own_pct = round(sum(p.pct for p in mine if p.pct is not None), 1) if any(p.pct is not None for p in mine) else None
        moment = well.well_start or well.well_complete
        found.append(
            _Loading(
                out=SequencingLoadingOut(
                    key=f"{well.key}|{tube}",
                    run_name=well.run_name,
                    run_id=run_ids.get(run_key(well.run_name) or ""),
                    plate_number=well.plate_number,
                    well_label=well.well_label,
                    run_date=moment.date() if moment else None,
                    tube=tube,
                    via_other_tube=not direct,
                    loading_conc=well.loading_conc,
                    tube_hifi_gb=_gb(tube_bases),
                    cell_hifi_gb=well.hifi_yield_gb,
                    pct_of_cell=tube_pct,
                    plex=plex,
                    hifi_read_length_kb=round(well.hifi_read_length_mean / 1000, 1)
                    if well.hifi_read_length_mean is not None
                    else None,
                    qc_state=well.qc_state or None,
                    movie_minutes=well.movie_minutes,
                    smrt_link_url=smrt_link_url(well),
                    members=members,
                ),
                sort_key=(moment.isoformat() if moment else "", well.run_name, well.plate_number, well.well_label),
                own_bases=own_bases,
                own_pct=own_pct,
                well=well,
            )
        )
    found.sort(key=lambda ld: ld.sort_key)
    return found


def _summary(loadings: list[_Loading]) -> SequencingSummaryOut | None:
    if not loadings:
        return None
    last = loadings[-1]
    return SequencingSummaryOut(
        cells=len({ld.well.well_pk for ld in loadings}),
        hifi_gb=round(sum(ld.own_bases or 0 for ld in loadings) / 1e9, 2),
        last_run_name=last.out.run_name,
        last_run_date=last.out.run_date,
        last_well=f"Plate {last.out.plate_number} {last.out.well_label}",
        last_loading_conc=last.out.loading_conc,
        last_hifi_gb=_gb(last.own_bases),
        last_pct_of_cell=last.own_pct,
        last_plex=last.out.plex,
        last_qc_state=last.out.qc_state,
    )


def _sample_keys(db: Session, sample_ids: list[int]) -> list[SampleKeys]:
    rows = db.execute(select(Sample.id, Sample.pool_id, Sample.sanger_ids).where(Sample.id.in_(sample_ids)))
    return [SampleKeys(sid, pool or "", tuple(sanger or ())) for sid, pool, sanger in rows]


def _history(db: Session, keys: list[SampleKeys], refresh: bool) -> dict[int, list[_Loading]]:
    """Each sample's loadings, oldest first. Raises MlwhUnavailable."""
    tubes = _variants(k.pool_id for k in keys)
    sanger_ids = _variants(s for k in keys for s in k.sanger_ids)
    db.rollback()  # hand RunNx's connection back while MLWH is asked (see mlwh_wells)
    products, wells = mlwh_wells.fetch(
        ("sequencing_history", tuple(tubes), tuple(sanger_ids)),
        lambda engine: _read(engine, tubes, sanger_ids),
        ttl=_TTL_S,
        refresh=refresh,
    )
    groups: dict[tuple[int, str], list[_Product]] = defaultdict(list)
    for p in products:
        groups[(p.well_pk, p.tube)].append(p)
    run_ids = run_ids_by_key(db) if products else {}
    return {k.sample_id: _loadings_for(k, groups, wells, run_ids) for k in keys}


def build_summaries(db: Session, sample_ids: list[int]) -> SequencingSummariesOut:
    """The highlights for a page of samples - no loadings, so a list stays light."""
    out = SequencingSummariesOut(configured=mlwh.is_configured())
    if not out.configured or not sample_ids:
        out.ok = out.configured
        return out
    keys = _sample_keys(db, sample_ids)
    try:
        history = _history(db, keys, refresh=False)
    except mlwh_wells.MlwhUnavailable as exc:
        out.error = str(exc)
        return out
    out.ok = True
    out.samples = {sid: summary for sid, loadings in history.items() if (summary := _summary(loadings))}
    return out


def build_history(db: Session, sample_id: int, *, refresh: bool = False) -> SequencingHistoryOut | None:
    """One sample's every loading, oldest first. None when RunNx has no such sample."""
    keys = _sample_keys(db, [sample_id])
    if not keys:
        return None
    out = SequencingHistoryOut(configured=mlwh.is_configured())
    if not out.configured:
        return out
    try:
        loadings = _history(db, keys, refresh=refresh)[sample_id]
    except mlwh_wells.MlwhUnavailable as exc:
        out.error = str(exc)
        return out
    out.ok = True
    out.summary = _summary(loadings)
    out.loadings = [ld.out for ld in loadings]
    return out
