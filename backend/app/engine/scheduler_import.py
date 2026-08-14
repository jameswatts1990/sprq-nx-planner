"""Convert the lab's PacBio scheduler sheet into structured, reviewable pools.

The scheduler sheet (the "sequencing tracker" layout in tracker_columns.py) lists one row
*per sample*. Several samples can share one SMRT Cell: a row's "Portion of SMRT Cell" says how
much of a cell it occupies (1 = a whole cell, 0.5 = half, 0.25 = a quarter). Samples that share
a cell form a *pool* — in this app they become one sample, keyed by its Pool ID.

Grouping is by **Pool ID**, matching how the sheet is actually laid out: a pool's lead row
carries the Pool ID and the rows beneath it either repeat that Pool ID or leave it blank; a new,
different Pool ID starts the next pool. The summed "Portion of SMRT Cell" is a **sense-check** on
top of that grouping — a pool whose portions land near a whole cell is accepted automatically;
one that's materially under- or over-subscribed (or has an unreadable portion) is flagged for the
user to review and authorise, rather than silently dropped as an earlier portion-only version did.

Every original column is carried through the pool collapse (only the consumed Portion column is
dropped), so nothing the sheet holds is lost before the mapping-review wizard. Column detection
reuses the ordinary importer's fuzzy matcher (`suggest_column_map`) rather than a private strict
allow-list, so a renamed header still maps — and the wizard flags any non-exact match to confirm.

Collapse rules:
  - Barcodes and Sanger IDs combine every distinct value across the pool, in source order.
  - Every other column takes the first non-empty value across the pool.
  - Portion accepts "0.5", "50%" or a bare "50" (all -> 0.5); "1"/"100%"/"100" -> 1.0.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from app.engine.csv_parse import parse_csv, split_barcodes
from app.engine.import_fields import K_BARCODES, K_POOL_ID, K_SANGER, suggest_column_map
from app.engine.tracker_columns import normalize_header

# A pool's summed portion may drift this far from a whole cell (±2 percentage points) and still
# auto-accept — enough to absorb equal-split rounding (3×33%=99%, 14×7%≈98%) without waving
# through a genuinely under-/over-subscribed cell, which is surfaced for review instead. This is
# the single knob for "how close to 100% counts as a whole cell".
POOL_SUM_AUTO_TOLERANCE = 0.02

# "Portion of SMRT Cell" is scheduler-only (not a stored Sample field), so it isn't in
# IMPORTABLE_FIELDS — resolve it here with the same normalized-substring rule the fuzzy matcher uses.
_PORTION_ALIASES = ("portion of smrt cell", "portion")


class SchedulerFormatError(ValueError):
    """The upload doesn't look like the scheduler sheet (a required column is missing).

    Carries a lab-readable message; the API layer surfaces it as a 400 so the user can act."""


@dataclass
class SchedulerPoolMember:
    """One source row inside a pool, for the review breakdown ("3 samples at 33%")."""

    label: str
    portion_percent: int


@dataclass
class SchedulerPool:
    pool_id: str  # first non-empty Pool ID in the pool ("" if none)
    status: str  # "ok" (auto-accepted) | "review" (needs authorisation)
    portion_percent: int  # summed share of a SMRT Cell, as a whole percent
    note: str | None  # why it needs review (None when ok)
    members: list[SchedulerPoolMember]
    row: list[str]  # collapsed cells, aligned to SchedulerConversion.columns


@dataclass
class SchedulerConversion:
    columns: list[str]  # original scheduler headers (the Portion column removed)
    pools: list[SchedulerPool]  # index-aligned to the rows the UI builds for preview/commit
    source_row_count: int  # data rows read (header excluded)
    pool_count: int  # pools formed (all statuses)
    review_count: int  # pools needing authorisation
    warnings: list[str] = field(default_factory=list)


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
    if had_percent or value > 1:
        value = value / 100
    return value


def _cell(row: list[str], idx: int | None) -> str:
    if idx is None:
        return ""
    return row[idx] if 0 <= idx < len(row) else ""


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


def _resolve_portion_col(header: list[str]) -> int | None:
    normalized = [normalize_header(h) for h in header]
    for i, h in enumerate(normalized):
        if any(alias in h for alias in _PORTION_ALIASES):
            return i
    return None


@dataclass
class _Group:
    pool_id: str
    rows: list[list[str]]


def _has_signal(row: list[str], pool_col: int, portion_col: int, barcode_col: int) -> bool:
    """True if the row is a real sample line rather than a totals/notes row: it carries a Pool
    ID, a readable portion, or a barcode. A row filling only unrelated columns has none of these."""
    if _cell(row, pool_col).strip():
        return True
    if parse_portion(_cell(row, portion_col)) is not None:
        return True
    if _cell(row, barcode_col).strip():
        return True
    return False


def _group_by_pool_id(
    data_rows: list[list[str]], pool_col: int, portion_col: int, barcode_col: int
) -> list[_Group]:
    """Group consecutive rows into pools by Pool ID: a non-blank Pool ID that differs from the
    open pool's id closes it and starts the next; the same or a blank Pool ID continues it."""
    groups: list[_Group] = []
    current: _Group | None = None
    for row in data_rows:
        if not _has_signal(row, pool_col, portion_col, barcode_col):
            continue  # totals / notes / blank separator row
        pid = _cell(row, pool_col).strip()
        if pid and current is not None and current.pool_id and pid != current.pool_id:
            groups.append(current)
            current = None
        if current is None:
            current = _Group(pool_id=pid, rows=[])
        elif pid and not current.pool_id:
            current.pool_id = pid  # a blank-led pool adopts the first Pool ID it sees
        current.rows.append(row)
    if current is not None:
        groups.append(current)
    return groups


def _member_label(row: list[str], sanger_col: int | None, pool_col: int, barcode_col: int, index: int) -> str:
    for idx in (sanger_col, pool_col, barcode_col):
        value = _cell(row, idx).strip()
        if value:
            return value
    return f"Row {index + 1}"


def _finalize_pool(
    group: _Group,
    out_indices: list[int],
    pool_col: int,
    portion_col: int,
    barcode_col: int,
    sanger_col: int | None,
) -> SchedulerPool:
    rows = group.rows

    def first_nonempty(col: int) -> str:
        for row in rows:
            value = _cell(row, col).strip()
            if value:
                return value
        return ""

    def combined(col: int | None, splitter) -> list[str]:
        out: list[str] = []
        for row in rows:
            for value in splitter(_cell(row, col)):
                if value and value not in out:
                    out.append(value)
        return out

    # Sum the pool's portions; an unreadable portion counts as 0 and flags the pool for review.
    running = 0.0
    had_unreadable = False
    members: list[SchedulerPoolMember] = []
    for i, row in enumerate(rows):
        portion = parse_portion(_cell(row, portion_col))
        if portion is None:
            had_unreadable = True
            portion = 0.0
        running += portion
        members.append(
            SchedulerPoolMember(
                label=_member_label(row, sanger_col, pool_col, barcode_col, i),
                portion_percent=round(portion * 100),
            )
        )

    barcodes = combined(barcode_col, split_barcodes)
    sanger = combined(sanger_col, _split_ids) if sanger_col is not None else []

    row_out: list[str] = []
    for col in out_indices:
        if col == barcode_col:
            row_out.append("; ".join(barcodes))
        elif sanger_col is not None and col == sanger_col:
            # JSON array so the importer re-splits it; a lone ID stays plain.
            row_out.append(json.dumps(sanger) if len(sanger) > 1 else (sanger[0] if sanger else ""))
        else:
            row_out.append(first_nonempty(col))

    percent = round(running * 100)
    reasons: list[str] = []
    if abs(running - 1.0) > POOL_SUM_AUTO_TOLERANCE:
        reasons.append(f"these samples fill {percent}% of a SMRT Cell, not a whole cell")
    if had_unreadable:
        reasons.append("a sample's Portion of SMRT Cell couldn't be read")
    note = None
    if reasons:
        joined = "; ".join(reasons)
        note = joined[0].upper() + joined[1:] + "."

    return SchedulerPool(
        pool_id=group.pool_id or first_nonempty(pool_col),
        status="review" if reasons else "ok",
        portion_percent=percent,
        note=note,
        members=members,
        row=row_out,
    )


def convert_scheduler_csv(raw_text: str | None) -> SchedulerConversion:
    """Pool a scheduler-sheet CSV into structured, reviewable pools that carry every column.

    Raises SchedulerFormatError if the file doesn't carry the columns the sheet must have."""
    rows = parse_csv(raw_text)
    if not rows:
        raise SchedulerFormatError("The scheduler file appears to be empty.")

    header = rows[0]
    fmap = suggest_column_map(header)
    pool_col = fmap.get(K_POOL_ID)
    barcode_col = fmap.get(K_BARCODES)
    sanger_col = fmap.get(K_SANGER)
    portion_col = _resolve_portion_col(header)

    missing = []
    if pool_col is None:
        missing.append("Pool ID")
    if barcode_col is None:
        missing.append("Complex Batch ID / Barcodes")
    if portion_col is None:
        missing.append("Portion of SMRT Cell")
    if missing:
        raise SchedulerFormatError(
            "This doesn't look like a scheduler sheet — couldn't find the column(s): "
            + ", ".join(missing)
            + ". Expected the lab's sequencing-tracker layout (Pool ID, Portion of SMRT Cell, "
            "Complex Batch ID…). Use ‘Upload CSV’ for a sheet that isn't pooled."
        )

    data_rows = rows[1:]
    # Carry every original column through except the Portion column, which pooling consumes.
    out_indices = [i for i in range(len(header)) if i != portion_col]
    columns = [header[i] for i in out_indices]

    groups = _group_by_pool_id(data_rows, pool_col, portion_col, barcode_col)
    pools = [
        _finalize_pool(g, out_indices, pool_col, portion_col, barcode_col, sanger_col) for g in groups
    ]

    warnings: list[str] = []
    if not pools:
        warnings.append("No sample rows were found in the sheet — nothing to import.")

    return SchedulerConversion(
        columns=columns,
        pools=pools,
        source_row_count=len(data_rows),
        pool_count=len(pools),
        review_count=sum(1 for p in pools if p.status == "review"),
        warnings=warnings,
    )
