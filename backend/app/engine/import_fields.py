"""The one canonical list of importable Sample fields.

This single spec drives everything on the input side so they can never drift:
  - the import mapping-review UI (target fields + which columns feed them),
  - the auto-suggested column mapping (`suggest_column_map`),
  - the downloadable template CSV (headers + example row),
  - the manual "Add to backlog" form.

`aliases` are the substring synonyms used to *pre-fill* the mapping from a file's headers;
they mirror the old `_find` needles in normalize.py plus a couple that let the sequencing
tracker sheet auto-map ("traction id" -> external_id, "complex batch id" -> barcodes).
The user always sees and can correct the suggestion, so substring matching being loose is
fine here.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.engine.tracker_columns import normalize_header

# Field keys. These match ParsedSample attribute names where they differ from the DB
# column (external_id -> ParsedSample.id, parent_sample -> ParsedSample.parent).
K_EXTERNAL_ID = "external_id"
K_BARCODES = "barcodes"
K_SANGER = "sanger"
K_CONTAINER_ID = "container_id"
K_PARENT_SAMPLE = "parent_sample"
K_TARGET_OPLC = "target_oplc"
K_OPLC = "oplc"
K_VOLUME = "volume"
K_ADAPTIVE_LOADING = "adaptive_loading"
K_FULL_RES_BASE_Q = "full_resolution_base_q"
K_PRIORITY = "priority"
K_CCS_KINETICS = "ccs_kinetics"


@dataclass(frozen=True)
class ImportField:
    key: str
    label: str
    example: str
    kind: str = "text"  # text | number | barcodes | sanger
    required: bool = False
    aliases: tuple[str, ...] = field(default_factory=tuple)


# Order here is the order shown in the mapping UI, the manual-add form, and the template.
IMPORTABLE_FIELDS: list[ImportField] = [
    ImportField(
        K_EXTERNAL_ID, "Traction / External ID", "TRAC-2-26256", required=True,
        aliases=("traction id", "external id", "container", "parent sample", "sample"),
    ),
    ImportField(
        K_BARCODES, "Barcodes", "bc2074, bc2075", kind="barcodes", required=True,
        aliases=("barcode", "complex batch id"),
    ),
    ImportField(K_SANGER, "Sanger Sample IDs", "DTOL16944651", kind="sanger", aliases=("sanger",)),
    ImportField(K_CONTAINER_ID, "Plate ID / Container", "NT1885345D", aliases=("plate id", "container")),
    ImportField(K_PARENT_SAMPLE, "Parent Sample", "TRAC-2-26256", aliases=("parent sample",)),
    ImportField(
        K_TARGET_OPLC, "Target OPLC (pM)", "300", kind="number",
        aliases=("target oplc", "target loading concentration"),
    ),
    ImportField(
        K_OPLC, "OPLC / Loading Conc. (pM)", "250", kind="number",
        aliases=("actual oplc", "loading conc.", "oplc"),
    ),
    ImportField(K_VOLUME, "Volume to Load (uL)", "12", kind="number",
                aliases=("volume to load", "library volume", "volume")),
    ImportField(K_ADAPTIVE_LOADING, "Adaptive Loading", "Adaptive", aliases=("adaptive loading",)),
    ImportField(K_FULL_RES_BASE_Q, "Full-Resolution Base Q", "No", aliases=("full resolution", "full-resolution")),
    ImportField(K_PRIORITY, "Priority", "High", aliases=("priority", "prioity")),
    ImportField(K_CCS_KINETICS, "CCS Kinetics", "Yes", aliases=("kinetics",)),
]

FIELDS_BY_KEY: dict[str, ImportField] = {f.key: f for f in IMPORTABLE_FIELDS}
REQUIRED_KEYS: tuple[str, ...] = tuple(f.key for f in IMPORTABLE_FIELDS if f.required)


def suggest_column_map(header: list[str]) -> dict[str, int]:
    """Best-guess {field_key: column_index} for a file's header row.

    For each field, aliases are tried in priority order; the first header (in column order)
    whose normalized text contains the alias wins. Fields with no match are omitted."""
    normalized = [normalize_header(h) for h in header]
    mapping: dict[str, int] = {}
    for f in IMPORTABLE_FIELDS:
        for alias in f.aliases:
            idx = next((i for i, h in enumerate(normalized) if alias in h), -1)
            if idx >= 0:
                mapping[f.key] = idx
                break
    return mapping
