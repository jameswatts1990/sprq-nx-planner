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

from app.engine.constants import DEFAULT_MOVIE_HOURS, MOVIE_HOURS_CHOICES, normalize_priority
from app.engine.csv_parse import parse_csv, split_barcodes
from app.engine.import_fields import (
    K_ACTUAL_OPLC,
    K_ADAPTIVE_LOADING,
    K_BARCODES,
    K_BASE_KINETICS,
    K_CLEANED_COMPLEX_VOL,
    K_EXTERNAL_ID,
    K_FULL_RES_BASE_Q,
    K_LOADING_BUFFER_VOL,
    K_MOVIE_TIME,
    K_PARENT_SAMPLE,
    K_PRIORITY,
    K_SANGER,
    K_TARGET_OPLC,
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


def coerce_movie_hours(value: object) -> int:
    """A sample's movie / acquisition time, normalized to one of MOVIE_HOURS_CHOICES
    (12/24/30). Anything missing, blank, or out of range falls back to DEFAULT_MOVIE_HOURS
    (24h) - so a stored movie time is always a valid choice, and "not imported" means 24h.
    Used on manual create/edit and on import."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return DEFAULT_MOVIE_HOURS
    v = _js_parse_float(value if isinstance(value, str) else str(value))
    if v is None:
        return DEFAULT_MOVIE_HOURS
    n = int(round(v))
    return n if n in MOVIE_HOURS_CHOICES else DEFAULT_MOVIE_HOURS


def _parse_movie_time(raw: str | None) -> int | None:
    """Parse a movie-time import cell to an int (12/24/30) or None when blank/unparseable -
    None is left for the persist layer to fill with the default, so a blank column reads as
    "use the default 24h" rather than a forced value here."""
    if raw is None or not raw.strip():
        return None
    v = _js_parse_float(raw)
    return int(round(v)) if v is not None else None


# Boolean settings fields (Adaptive Loading, Full-Resolution Base Q, Include Base Kinetics)
# are stored canonically as "True"/"False". Import accepts the common truthy/falsy spellings
# a lab sheet might use and rejects anything else (recorded as a per-row warning, value blanked).
_TRUE_TOKENS = {"true", "t", "yes", "y", "1", "adaptive"}
_FALSE_TOKENS = {"false", "f", "no", "n", "0"}


def parse_bool_field(raw: str | None) -> tuple[str | None, bool]:
    """Normalize a free-text True/False cell to canonical "True"/"False".

    Returns (value, ok): value is "True"/"False"/None (blank -> None); ok is False when a
    non-empty value couldn't be interpreted as a boolean, so callers can flag it."""
    if raw is None:
        return None, True
    s = raw.strip().lower()
    if not s:
        return None, True
    if s in _TRUE_TOKENS:
        return "True", True
    if s in _FALSE_TOKENS:
        return "False", True
    return None, False


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

        def boolean(key: str, label: str) -> str | None:
            value, ok = parse_bool_field(cell(r, key))
            if not ok:
                warnings.append(f'Row "{sample_id}": {label} must be True or False — left blank.')
            return value

        sanger_raw = cell(r, K_SANGER)
        samples.append(
            ParsedSample(
                id=sample_id,
                barcodes=barcodes,
                parent=cell(r, K_PARENT_SAMPLE).strip(),
                sanger=_parse_sanger(sanger_raw) if sanger_raw.strip() else [],
                target_oplc=_parse_float_or_none(cell(r, K_TARGET_OPLC)),
                actual_oplc=_parse_float_or_none(cell(r, K_ACTUAL_OPLC)),
                cleaned_complex_volume=_parse_float_or_none(cell(r, K_CLEANED_COMPLEX_VOL)),
                loading_buffer_volume=_parse_float_or_none(cell(r, K_LOADING_BUFFER_VOL)),
                adaptive_loading=boolean(K_ADAPTIVE_LOADING, "Adaptive Loading"),
                full_resolution_base_q=boolean(K_FULL_RES_BASE_Q, "Full-Resolution Base Q"),
                # Coerced to a canonical label (High/Medium/Standard); an unrecognized or
                # blank value becomes "" here so the persist layer fills the configured default.
                priority=normalize_priority(cell(r, K_PRIORITY)) or "",
                base_kinetics=boolean(K_BASE_KINETICS, "Include Base Kinetics"),
                movie_time=_parse_movie_time(cell(r, K_MOVIE_TIME)),
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
