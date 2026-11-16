"""Direct port of parseCSV / splitBarcodes from revio-nx-planner.html (lines 385-397)."""
from __future__ import annotations

import re

_BARCODE_SPLIT_RE = re.compile(r"[,;/\s]+")


def parse_csv(text: str | None) -> list[list[str]]:
    """Char-by-char CSV parser matching the prototype's quote/comma/CRLF handling exactly."""
    s = "" if text is None else str(text)
    rows: list[list[str]] = []
    field = ""
    row: list[str] = []
    in_quotes = False
    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        if in_quotes:
            if c == '"':
                if i + 1 < n and s[i + 1] == '"':
                    field += '"'
                    i += 1
                else:
                    in_quotes = False
            else:
                field += c
        else:
            if c == '"':
                in_quotes = True
            elif c == ",":
                row.append(field)
                field = ""
            elif c == "\n":
                row.append(field)
                rows.append(row)
                row = []
                field = ""
            elif c == "\r":
                pass
            else:
                field += c
        i += 1
    if field or row:
        row.append(field)
        rows.append(row)
    return [r for r in rows if any(v.strip() != "" for v in r)]


def _barcode_parts(v: str | None) -> list[str]:
    if not v:
        return []
    return [p.strip() for p in _BARCODE_SPLIT_RE.split(v) if p.strip()]


def split_barcodes(v: str | None) -> list[str]:
    """Splits on comma/semicolon/slash/whitespace, trims, drops empties, dedupes preserving order."""
    return list(dict.fromkeys(_barcode_parts(v)))


def repeated_barcodes(cells: list[str]) -> list[str]:
    """Barcodes listed more than once across these cells (in first-seen order) - the ones
    split_barcodes collapses to a single copy. The import preview warns about them."""
    seen: set[str] = set()
    repeated: list[str] = []
    for cell in cells:
        for bc in _barcode_parts(cell):
            if bc in seen and bc not in repeated:
                repeated.append(bc)
            seen.add(bc)
    return repeated
