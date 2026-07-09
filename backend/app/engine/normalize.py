"""Direct port of normalizeSamples from revio-nx-planner.html (lines 399-429).

Column-priority fallback (Container -> Parent Sample -> Sample -> column 0), the
no-header two-column fallback, and the "sanger IDs as JSON array or raw string" and
"parseFloat(x)||null" quirks (including treating 0 as falsy, matching the JS `||`
operator) are all preserved intentionally - see the backend plan's "porting the
algorithms" section for why these are kept bug-compatible with the prototype.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from app.engine.csv_parse import parse_csv, split_barcodes
from app.engine.types import ParsedSample

_LEADING_NUMBER_RE = re.compile(r"^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?")


@dataclass
class NormalizeResult:
    samples: list[ParsedSample]
    warnings: list[str] = field(default_factory=list)


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


def _find(header: list[str], *needles: str) -> int:
    for i, h in enumerate(header):
        if any(needle in h for needle in needles):
            return i
    return -1


def _parse_sanger(raw: str) -> list[str]:
    raw = raw.strip()
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return [raw]
    if isinstance(parsed, list):
        return [str(x) for x in parsed]
    return [str(parsed)]


def normalize_samples(text: str | None) -> NormalizeResult:
    rows = parse_csv(text)
    if not rows:
        return NormalizeResult(samples=[], warnings=["No rows found in the pasted text."])

    header = [h.strip().lower() for h in rows[0]]
    has_header = any("barcode" in h for h in header)
    warnings: list[str] = []
    parent_idx = sanger_idx = oplc_idx = vol_idx = -1

    if has_header:
        id_idx = _find(header, "container")
        if id_idx < 0:
            id_idx = _find(header, "parent sample")
        if id_idx < 0:
            id_idx = _find(header, "sample")
        if id_idx < 0:
            id_idx = 0
        bc_idx = _find(header, "barcode")
        parent_idx = _find(header, "parent sample")
        sanger_idx = _find(header, "sanger")
        oplc_idx = _find(header, "oplc")
        vol_idx = _find(header, "volume")
        data_rows = rows[1:]
    else:
        id_idx, bc_idx = 0, 1
        data_rows = rows
        warnings.append("No header row detected — read as two columns: sample, barcodes.")

    samples: list[ParsedSample] = []
    for n, r in enumerate(data_rows):
        raw_id = r[id_idx] if id_idx < len(r) else ""
        sample_id = (raw_id or f"Sample {n + 1}").strip()
        raw_bc = r[bc_idx] if bc_idx < len(r) else ""
        barcodes = split_barcodes(raw_bc)
        if not barcodes:
            warnings.append(f'Row "{sample_id}" has no barcodes — skipped.')
            continue

        sanger: list[str] = []
        if 0 <= sanger_idx < len(r) and r[sanger_idx]:
            sanger = _parse_sanger(r[sanger_idx])

        parent = (r[parent_idx] or "").strip() if 0 <= parent_idx < len(r) else ""
        oplc = _parse_float_or_none(r[oplc_idx]) if 0 <= oplc_idx < len(r) else None
        volume = _parse_float_or_none(r[vol_idx]) if 0 <= vol_idx < len(r) else None

        samples.append(
            ParsedSample(
                id=sample_id,
                barcodes=barcodes,
                parent=parent,
                sanger=sanger,
                oplc=oplc,
                volume=volume,
                key=f"{sample_id}#{n}",
            )
        )
    return NormalizeResult(samples=samples, warnings=warnings)
