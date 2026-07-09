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


def split_barcodes(v: str | None) -> list[str]:
    """Splits on comma/semicolon/slash/whitespace, trims, drops empties, dedupes preserving order."""
    if not v:
        return []
    parts = [p.strip() for p in _BARCODE_SPLIT_RE.split(v) if p.strip()]
    return list(dict.fromkeys(parts))
