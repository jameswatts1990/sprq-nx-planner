"""Import profile for the lab's "sequencing tracker" Google Sheet layout.

The default importer (normalize.py) fuzzy-matches headers by substring, which mis-fires
badly on this sheet (it would grab "Sanger Sample ID" as the ID and "Library Volume..."
as the load volume). This profile instead maps columns by *exact* (whitespace-normalized)
header, using the shared spec in tracker_columns.py.

P1-only scope: only the Sample-level fields the app stores are read. Placement/run data
(well, instrument, run id) can't attach to a backlog sample and is intentionally dropped.
Rows are imported into the backlog only when their Status is Pending/blank — rows already
on the instrument (In Progress / Loaded) are skipped, since import is a backlog sync.
"""
from __future__ import annotations

from app.engine.csv_parse import parse_csv, split_barcodes
from app.engine.normalize import NormalizeResult, SkippedRow, _parse_float_or_none, _parse_sanger
from app.engine.tracker_columns import (
    K_BARCODES,
    K_CCS_KINETICS,
    K_LOADING_CONC,
    K_PLATE_ID,
    K_PRIORITY,
    K_SANGER,
    K_STATUS,
    K_TARGET_OPLC,
    K_TRACTION_ID,
    TRACKER_KEY_BY_HEADER,
    normalize_header,
)
from app.engine.types import ParsedSample

# Statuses whose rows become new backlog samples. Anything else (In Progress, Loaded,
# and any completed/failed marker) is already on the instrument and is skipped.
_BACKLOG_STATUSES = {"", "pending"}


def looks_like_tracker(rows: list[list[str]]) -> bool:
    """True when the header row carries the tracker signature (Traction ID + cell location),
    which the default LIMS export and the two-column paste format never have."""
    if not rows:
        return False
    headers = {normalize_header(h) for h in rows[0]}
    return "traction id" in headers and "cell location" in headers


def normalize_tracker(text: str | None) -> NormalizeResult:
    rows = parse_csv(text)
    if not rows:
        return NormalizeResult(samples=[], warnings=["No rows found in the pasted text."])

    header = rows[0]
    colmap: dict[str, int] = {}
    for i, h in enumerate(header):
        key = TRACKER_KEY_BY_HEADER.get(normalize_header(h))
        if key is not None and key not in colmap:
            colmap[key] = i

    warnings: list[str] = []
    skipped: list[SkippedRow] = []
    samples: list[ParsedSample] = []

    for n, r in enumerate(rows[1:]):
        def get(key: str) -> str:
            idx = colmap.get(key, -1)
            return r[idx].strip() if 0 <= idx < len(r) else ""

        raw_id = get(K_TRACTION_ID)
        raw_bc = get(K_BARCODES)

        # Separator / label / blank rows (no Traction ID and no barcodes) — skip silently;
        # the sheet is full of them and warning on each would drown the real messages.
        if not raw_id and not raw_bc:
            continue

        status_raw = get(K_STATUS)
        if status_raw.lower() not in _BACKLOG_STATUSES:
            warnings.append(f'Row "{raw_id or "?"}" is "{status_raw}" (already on instrument) — skipped.')
            continue

        barcodes = split_barcodes(raw_bc)
        if not barcodes:
            ident = raw_id or f"Sample {n + 1}"
            warnings.append(f'Row "{ident}" has no barcodes — skipped.')
            skipped.append(SkippedRow(identifier=ident, reason="No barcodes"))
            continue

        sanger_raw = get(K_SANGER)
        samples.append(
            ParsedSample(
                id=raw_id or f"Sample {n + 1}",
                barcodes=barcodes,
                sanger=_parse_sanger(sanger_raw) if sanger_raw else [],
                oplc=_parse_float_or_none(get(K_LOADING_CONC)),
                target_oplc=_parse_float_or_none(get(K_TARGET_OPLC)),
                container_id=get(K_PLATE_ID),
                priority=get(K_PRIORITY),
                ccs_kinetics=get(K_CCS_KINETICS),
                key=f"{raw_id}#{n}",
            )
        )

    return NormalizeResult(samples=samples, warnings=warnings, skipped=skipped)
