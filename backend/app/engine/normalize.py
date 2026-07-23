"""Turns parsed CSV rows into ParsedSample records.

Column->field resolution now goes through an explicit column map (field key -> column
index): the mapping-review import passes one the user has confirmed, and the legacy
one-shot path derives one via `suggest_column_map` (engine/import_fields.py). The
"sanger IDs as JSON array or raw string" and "parseFloat(x)||null" (0 is falsy) quirks are
preserved intentionally - see the backend plan's "porting the algorithms" section.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from app.engine.csv_parse import parse_csv, split_barcodes
from app.engine.import_fields import (
    K_ADAPTIVE_LOADING,
    K_BARCODES,
    K_CCS_KINETICS,
    K_CONTAINER_ID,
    K_EXTERNAL_ID,
    K_FULL_RES_BASE_Q,
    K_OPLC,
    K_PARENT_SAMPLE,
    K_PRIORITY,
    K_SANGER,
    K_TARGET_OPLC,
    K_VOLUME,
    suggest_column_map,
)
from app.engine.types import ParsedSample

_LEADING_NUMBER_RE = re.compile(r"^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?")


@dataclass
class SkippedRow:
    """A row that parsed but was not imported (e.g. no barcodes), surfaced as an actionable
    list of sample IDs so the user can fix the source and re-import."""

    identifier: str
    reason: str


@dataclass
class NormalizeResult:
    samples: list[ParsedSample]
    warnings: list[str] = field(default_factory=list)
    skipped: list[SkippedRow] = field(default_factory=list)


def _js_parse_float(raw: str | None) -> float | None:
    """Mimics JS parseFloat(): parses a leading numeric substring, returns None (NaN) if none."""
    if raw is None:
        return None
    m = _LEADING_NUMBER_RE.match(str(raw))
    if not m or m.group(0).strip() in ("", "+", "-"):
        return None
    try:
        return float(m.group(0))
    except ValueError:
        return None


def _parse_float_or_none(raw: str | None) -> float | None:
    """Mimics `parseFloat(x)||null` - note 0 is falsy in JS, so an actual 0 becomes None too."""
    v = _js_parse_float(raw)
    return v if v else None


def _parse_sanger(raw: str) -> list[str]:
    raw = raw.strip()
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return [raw]
    if isinstance(parsed, list):
        return [str(x) for x in parsed]
    return [str(parsed)]


def normalize_with_map(data_rows: list[list[str]], column_map: dict[str, int]) -> NormalizeResult:
    """Build ParsedSamples from data rows (header already stripped) using an explicit
    field-key -> column-index map. Rows with neither an ID nor barcodes are dropped silently
    (blank/separator rows); rows with an ID but no barcodes are recorded in `skipped`."""
    warnings: list[str] = []
    skipped: list[SkippedRow] = []
    samples: list[ParsedSample] = []

    def cell(r: list[str], key: str) -> str:
        idx = column_map.get(key, -1)
        return r[idx] if 0 <= idx < len(r) else ""

    for n, r in enumerate(data_rows):
        raw_id = cell(r, K_EXTERNAL_ID).strip()
        barcodes = split_barcodes(cell(r, K_BARCODES))

        if not raw_id and not barcodes:
            continue  # blank / separator / label row

        sample_id = raw_id or f"Sample {n + 1}"
        if not barcodes:
            warnings.append(f'Row "{sample_id}" has no barcodes — skipped.')
            skipped.append(SkippedRow(identifier=sample_id, reason="No barcodes"))
            continue

        sanger_raw = cell(r, K_SANGER)
        samples.append(
            ParsedSample(
                id=sample_id,
                barcodes=barcodes,
                parent=cell(r, K_PARENT_SAMPLE).strip(),
                sanger=_parse_sanger(sanger_raw) if sanger_raw.strip() else [],
                oplc=_parse_float_or_none(cell(r, K_OPLC)),
                target_oplc=_parse_float_or_none(cell(r, K_TARGET_OPLC)),
                volume=_parse_float_or_none(cell(r, K_VOLUME)),
                container_id=cell(r, K_CONTAINER_ID).strip(),
                adaptive_loading=cell(r, K_ADAPTIVE_LOADING).strip(),
                full_resolution_base_q=cell(r, K_FULL_RES_BASE_Q).strip(),
                priority=cell(r, K_PRIORITY).strip(),
                ccs_kinetics=cell(r, K_CCS_KINETICS).strip(),
                key=f"{sample_id}#{n}",
            )
        )

    return NormalizeResult(samples=samples, warnings=warnings, skipped=skipped)


def normalize_samples(text: str | None) -> NormalizeResult:
    """Legacy one-shot path (no user-confirmed mapping): auto-detect the header and map.

    Kept for direct API posts without a column_map; the mapping-review wizard calls
    normalize_with_map with an explicit, user-confirmed map instead."""
    rows = parse_csv(text)
    if not rows:
        return NormalizeResult(samples=[], warnings=["No rows found in the pasted text."])

    header = [h.strip().lower() for h in rows[0]]
    has_header = any("barcode" in h for h in header)

    if has_header:
        return normalize_with_map(rows[1:], suggest_column_map(rows[0]))

    result = normalize_with_map(rows, {K_EXTERNAL_ID: 0, K_BARCODES: 1})
    result.warnings.insert(0, "No header row detected — read as two columns: sample, barcodes.")
    return result
