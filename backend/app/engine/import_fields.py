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

from app.engine.constants import CANONICAL_PRIORITIES
from app.engine.tracker_columns import normalize_header

# Field keys. These match ParsedSample attribute names where they differ from the DB
# column (external_id -> ParsedSample.id, parent_sample -> ParsedSample.parent).
# The `external_id` column is surfaced to lab users as "Container ID" (see its label).
K_EXTERNAL_ID = "external_id"
K_BARCODES = "barcodes"
K_SANGER = "sanger"
K_PARENT_SAMPLE = "parent_sample"
K_TARGET_OPLC = "target_oplc"
# The actual (achieved) on-plate loading concentration, distinct from the planned Target
# OPLC. Round-trips with the tracker sheet's "Loading Conc. (pM)" column.
K_ACTUAL_OPLC = "actual_oplc"
K_ADAPTIVE_LOADING = "adaptive_loading"
K_FULL_RES_BASE_Q = "full_resolution_base_q"
K_PRIORITY = "priority"
K_BASE_KINETICS = "base_kinetics"
K_MOVIE_TIME = "movie_time_hours"
K_INSERT_SIZE = "insert_size_bp"
# Loading-dilution volumes (all optional) that pre-fill the batch sheet's SOP 7.3 worksheet.
# Importable, and also editable on the manual add/edit form like every other optional field.
# (Control Dilution 3 is a fixed 1 µL, printed on the batch sheet, so it isn't stored here.)
K_CLEANED_COMPLEX_VOL = "cleaned_complex_volume"
K_LOADING_BUFFER_VOL = "loading_buffer_volume"


@dataclass(frozen=True)
class ImportField:
    key: str
    label: str
    example: str
    kind: str = "text"  # text | number | barcodes | sanger | boolean | select
    required: bool = False
    aliases: tuple[str, ...] = field(default_factory=tuple)
    # For kind="select": the fixed set of values the field accepts. Rendered as a dropdown
    # on the manual add/edit form (and drives the admin default picker for the same field).
    choices: tuple[str, ...] = field(default_factory=tuple)
    # True for fields that can be mapped/imported from a file but aren't offered on the manual
    # "Add / edit sample" form — the value only ever comes in via an import and is shown only
    # on the batch sheet. The mapping-review UI still lists them; SampleModal filters them out.
    import_only: bool = False


# Order here is the order shown in the mapping UI, the manual-add form, and the template.
IMPORTABLE_FIELDS: list[ImportField] = [
    ImportField(
        K_EXTERNAL_ID, "Container ID", "TRAC-2-26256", required=True,
        aliases=("container id", "container", "traction id", "external id", "parent sample", "sample"),
    ),
    ImportField(
        K_BARCODES, "Barcodes", "bc2074, bc2075", kind="barcodes", required=True,
        aliases=("barcode", "complex batch id"),
    ),
    ImportField(K_SANGER, "Sanger Sample IDs", "DTOL16944651", kind="sanger", aliases=("sanger",)),
    ImportField(K_PARENT_SAMPLE, "Parent Sample", "TRAC-2-26256", aliases=("parent sample",)),
    ImportField(
        K_TARGET_OPLC, "Target OPLC (pM)", "300", kind="number",
        aliases=("target oplc", "target loading concentration"),
    ),
    ImportField(
        K_ACTUAL_OPLC, "Actual OPLC (pM)", "285", kind="number",
        aliases=("actual oplc", "loading conc", "loading concentration", "actual loading concentration"),
    ),
    ImportField(K_ADAPTIVE_LOADING, "Adaptive Loading", "True", kind="boolean",
                aliases=("adaptive loading",)),
    ImportField(K_FULL_RES_BASE_Q, "Full-Resolution Base Q", "False", kind="boolean",
                aliases=("full resolution", "full-resolution")),
    ImportField(K_PRIORITY, "Priority", "High (1)", kind="select", choices=CANONICAL_PRIORITIES,
                aliases=("priority", "prioity")),
    ImportField(K_BASE_KINETICS, "Include Base Kinetics", "False", kind="boolean",
                aliases=("include base kinetics", "base kinetics", "kinetics")),
    ImportField(
        K_MOVIE_TIME, "Movie time (h)", "24", kind="number",
        aliases=("movie time", "movie length", "run time", "acquisition time", "movie"),
    ),
    ImportField(
        K_INSERT_SIZE, "Insert Size (bp)", "15000", kind="number",
        aliases=("insert size", "fragment size", "insert length", "fragment length", "insert"),
    ),
    # Loading-dilution volumes that pre-fill the batch sheet's SOP 7.3 worksheet. Optional,
    # mappable from a normal CSV and carried automatically from the scheduler sheet; aliases
    # cover both the tidy labels here and the scheduler sheet's own longer headers so both
    # auto-map. Also editable on the manual add/edit form and the placed-sample slot popover.
    ImportField(
        K_CLEANED_COMPLEX_VOL, "Cleaned Complex Vol (uL)", "8", kind="number",
        aliases=("cleaned complex",),
    ),
    ImportField(
        K_LOADING_BUFFER_VOL, "Loading Buffer Vol (uL)", "6", kind="number",
        aliases=("loading buffer",),
    ),
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
