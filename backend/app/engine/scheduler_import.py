"""Convert the lab's PacBio scheduler sheet into the app's standard import CSV.

The scheduler sheet (the same "sequencing tracker" layout described in tracker_columns.py)
lists one row *per sample*, and several samples can share a single SMRT Cell — a row's
"Portion of SMRT Cell" says how much of a cell it occupies (1 = a whole cell, 0.5 = half,
0.25 = a quarter). Sequential rows whose portions add up to a whole cell are one *pool*:
they run together on one physical cell and, in this app, become one Container.

Where tracker_import.py imports this sheet one-row-per-sample (keyed by Traction ID, no
pooling), this module implements the pooling described in the `refactor-pacbio-run-csv`
skill: consolidate each completed pool into a single container row (Container ID = Pool
ID, barcodes/Sanger IDs combined across the pool) and emit a plain CSV with the app's
canonical headers. That CSV then flows through the ordinary import preview/mapping wizard
unchanged — every column auto-maps, so the lab never has to move columns by hand.

Pooling rules (mirrors the skill spec):
  - Portion is read as a fraction (accepts "0.5", "50%", or a whole "50").
  - Pools are built from *sequential* rows until the cumulative portion reaches 1
    (±0.001). A group that overshoots 100%, hits an unreadable portion, or ends the file
    part-way is reported and skipped rather than guessed at.
  - Container ID, Priority and Target OPLC take the first non-empty value in the pool.
  - Barcodes and Sanger IDs combine every distinct non-empty value across the pool, in
    source order (comma / JSON-array lists in a single cell are split into individuals).
  - Plate ID has no home in this app, so it's dropped (with a one-line note).
"""
from __future__ import annotations

import csv
import io
import json
import re
from dataclasses import dataclass, field

from app.engine.csv_parse import parse_csv, split_barcodes
from app.engine.tracker_columns import (
    K_BARCODES,
    K_PLATE_ID,
    K_POOL_ID,
    K_PORTION,
    K_PRIORITY,
    K_SANGER,
    K_TARGET_OPLC,
    normalize_header,
)

# Tolerance around a whole SMRT Cell: 0.1 percentage-point, matching the skill spec.
_TOLERANCE = 0.001

# Canonical headers of the CSV we emit. Chosen to match IMPORTABLE_FIELDS labels so the
# ordinary importer's suggest_column_map auto-maps every one of them.
OUT_HEADERS = ["Container ID", "Barcodes", "Sanger Sample IDs", "Priority", "Target OPLC (pM)"]

# field-key -> the normalized headers that feed it. Exact (whitespace-collapsed, lower-cased)
# matches only — we never silently borrow an unrelated column. The strings cover both the
# tracker sheet's own headers and the tidier variants the skill's output uses.
_FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    K_POOL_ID: ("pool id",),
    K_BARCODES: ("complex batch id", "barcodes"),
    K_SANGER: ("sanger sample id", "sanger sample ids"),
    K_PLATE_ID: ("plate id",),
    K_PRIORITY: ("priority", "prioity"),
    K_TARGET_OPLC: (
        "target loading concentration (pm)",
        "target loading concentration",
        "target oplc (pm)",
        "target oplc",
    ),
    K_PORTION: ("portion of smrt cell", "portion"),
}

# Without these three we can't produce importable containers: Pool ID is the Container ID,
# Complex Batch ID carries the barcodes, and Portion drives the pooling.
_REQUIRED_FIELDS = (K_POOL_ID, K_BARCODES, K_PORTION)
_REQUIRED_LABELS = {
    K_POOL_ID: "Pool ID",
    K_BARCODES: "Complex Batch ID (barcodes)",
    K_PORTION: "Portion of SMRT Cell",
}


class SchedulerFormatError(ValueError):
    """The upload doesn't look like the scheduler sheet (a required column is missing).

    Carries a lab-readable message; the API layer surfaces it as a 400 so the user can act."""


@dataclass
class SchedulerConversion:
    csv: str
    source_row_count: int  # data rows read (header excluded)
    pool_count: int  # completed pools emitted as containers
    warnings: list[str] = field(default_factory=list)


@dataclass
class _Pool:
    container_id: str
    barcodes: list[str]
    sanger: list[str]
    priority: str
    target_oplc: str


def _resolve_columns(header: list[str]) -> dict[str, int]:
    """Best {field_key: column_index} for the sheet's header row (first match wins per field)."""
    normalized = [normalize_header(h) for h in header]
    cols: dict[str, int] = {}
    for key, aliases in _FIELD_ALIASES.items():
        for i, h in enumerate(normalized):
            if h in aliases:
                cols[key] = i
                break
    return cols


def parse_portion(raw: str | None) -> float | None:
    """A row's share of one SMRT Cell as a fraction, or None if unreadable/blank.

    Accepts "0.5", "50%" and a whole "50" (all → 0.5); "1", "100%", "100" → 1.0."""
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    had_percent = s.endswith("%")
    s = s.rstrip("%").strip()
    try:
        value = float(s)
    except ValueError:
        return None
    if had_percent or value > 1 + _TOLERANCE:
        value = value / 100
    return value


def _split_ids(raw: str) -> list[str]:
    """Split one Sanger cell into individual IDs: a JSON array, or a comma/semicolon list.

    Placeholders like "ID not found" (no separator) are kept as a single value."""
    raw = (raw or "").strip()
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        parsed = None
    if isinstance(parsed, list):
        return [str(x).strip() for x in parsed if str(x).strip()]
    return [p.strip() for p in re.split(r"[;,]", raw) if p.strip()]


def _cell(row: list[str], idx: int | None) -> str:
    if idx is None:
        return ""
    return row[idx] if 0 <= idx < len(row) else ""


def _finalize(group: list[list[str]], cols: dict[str, int]) -> _Pool:
    def first_nonempty(key: str) -> str:
        for row in group:
            value = _cell(row, cols.get(key)).strip()
            if value:
                return value
        return ""

    def combined(key: str, splitter) -> list[str]:
        out: list[str] = []
        for row in group:
            for value in splitter(_cell(row, cols.get(key))):
                if value and value not in out:
                    out.append(value)
        return out

    return _Pool(
        container_id=first_nonempty(K_POOL_ID),
        barcodes=combined(K_BARCODES, split_barcodes),
        sanger=combined(K_SANGER, _split_ids),
        priority=first_nonempty(K_PRIORITY),
        target_oplc=first_nonempty(K_TARGET_OPLC),
    )


def _has_mapped_data(row: list[str], cols: dict[str, int]) -> bool:
    """True if the row carries any of the columns we care about — tells a real (if
    portion-less) data row apart from a totals/notes row that only fills unrelated columns."""
    return any(
        _cell(row, cols.get(key)).strip()
        for key in (K_POOL_ID, K_BARCODES, K_SANGER, K_TARGET_OPLC, K_PRIORITY, K_PLATE_ID)
    )


def _group_label(group: list[list[str]], cols: dict[str, int]) -> str:
    for row in group:
        pid = _cell(row, cols.get(K_POOL_ID)).strip()
        if pid:
            return f"pool '{pid}'"
    return "a pool with no Pool ID"


def _build_pools(data_rows: list[list[str]], cols: dict[str, int]) -> tuple[list[_Pool], list[str]]:
    pools: list[_Pool] = []
    warnings: list[str] = []
    group: list[list[str]] = []
    running = 0.0

    def reset() -> None:
        nonlocal group, running
        group = []
        running = 0.0

    for row in data_rows:
        portion = parse_portion(_cell(row, cols.get(K_PORTION)))

        if portion is None:
            if not _has_mapped_data(row, cols):
                continue  # trailing / totals / notes row — silently ignored
            if group:
                warnings.append(
                    f"{_group_label(group, cols)} was cut short by a row with an unreadable "
                    "'Portion of SMRT Cell' value — skipped."
                )
                reset()
            else:
                pid = _cell(row, cols.get(K_POOL_ID)).strip() or "(no Pool ID)"
                warnings.append(f"Row for '{pid}' has an unreadable 'Portion of SMRT Cell' value — skipped.")
            continue

        group.append(row)
        running += portion

        if running >= 1 - _TOLERANCE:
            if running <= 1 + _TOLERANCE:
                pools.append(_finalize(group, cols))
            else:
                warnings.append(
                    f"{_group_label(group, cols)} adds up to {round(running * 100)}% of a SMRT Cell "
                    "instead of 100% — skipped."
                )
            reset()

    if group:
        warnings.append(
            f"{_group_label(group, cols)} only reaches {round(running * 100)}% of a SMRT Cell "
            "(not a whole cell) — not imported."
        )

    return pools, warnings


def _pools_to_csv(pools: list[_Pool]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(OUT_HEADERS)
    for pool in pools:
        if len(pool.sanger) > 1:
            sanger_cell = json.dumps(pool.sanger)  # JSON array so the importer re-splits it
        else:
            sanger_cell = pool.sanger[0] if pool.sanger else ""
        writer.writerow(
            [
                pool.container_id,
                "; ".join(pool.barcodes),
                sanger_cell,
                pool.priority,
                pool.target_oplc,
            ]
        )
    return buf.getvalue()


def convert_scheduler_csv(raw_text: str | None) -> SchedulerConversion:
    """Parse a scheduler-sheet CSV and return the pooled, import-ready standard CSV.

    Raises SchedulerFormatError if the file doesn't carry the columns the sheet must have."""
    rows = parse_csv(raw_text)
    if not rows:
        raise SchedulerFormatError("The scheduler file appears to be empty.")

    cols = _resolve_columns(rows[0])
    missing = [_REQUIRED_LABELS[key] for key in _REQUIRED_FIELDS if key not in cols]
    if missing:
        raise SchedulerFormatError(
            "This doesn't look like a scheduler sheet — couldn't find the column(s): "
            + ", ".join(missing)
            + ". Expected the lab's sequencing-tracker layout (Pool ID, Portion of SMRT Cell, "
            "Complex Batch ID…)."
        )

    data_rows = rows[1:]
    pools, warnings = _build_pools(data_rows, cols)

    if K_PLATE_ID in cols:
        warnings.insert(0, "Plate ID isn't tracked by the planner, so that column was left out.")
    if not pools:
        warnings.append("No complete SMRT Cell (a pool of rows summing to 100%) was found — nothing to import.")

    return SchedulerConversion(
        csv=_pools_to_csv(pools),
        source_row_count=len(data_rows),
        pool_count=len(pools),
        warnings=warnings,
    )
