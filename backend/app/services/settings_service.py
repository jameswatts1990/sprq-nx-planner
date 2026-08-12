"""Read/write app-wide sample defaults (the loading options pre-filled on new samples).

Defaults are applied when a backlog sample is created (manual add or CSV import) and any
of these fields is left unspecified — an explicitly provided value (including an explicit
False) always wins. The manual add form also reads these to pre-fill its controls."""
from __future__ import annotations

import json
import math

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.engine.constants import (
    CELLS_PER_TRAY,
    DAY_START_HOUR,
    DEFAULT_INSERT_SIZE_REUSE_THRESHOLD_BP,
    DEFAULT_MOVIE_HOURS,
    DEFAULT_REPEAT_SAFE_MIN_UL,
    DEFAULT_TOTAL_COMPLEX_UL,
    MOVIE_CELL_POSITION,
    MOVIE_HOURS_CHOICES,
    MovieRules,
    PRIORITY_STANDARD,
    normalize_priority,
)
from app.engine.normalize import parse_bool_field
from app.models.settings import AppSetting

# Namespace prefix so sample-default keys never collide with other app_settings entries.
_PREFIX = "sample_default."

# The four defaultable sample fields and their built-in fallbacks (used when nothing has
# been stored yet). These match the product spec: adaptive loading on, the two others off,
# priority Standard.
SAMPLE_DEFAULT_FALLBACKS: dict[str, str] = {
    "adaptive_loading": "True",
    "full_resolution_base_q": "False",
    "base_kinetics": "False",
    "priority": PRIORITY_STANDARD,
}
SAMPLE_DEFAULT_KEYS: tuple[str, ...] = tuple(SAMPLE_DEFAULT_FALLBACKS)

# Which of the defaultable fields are True/False booleans (the rest is priority).
_BOOL_DEFAULT_KEYS = ("adaptive_loading", "full_resolution_base_q", "base_kinetics")


def get_sample_defaults(db: Session) -> dict[str, str]:
    """The current sample defaults, one entry per SAMPLE_DEFAULT_KEYS, falling back to the
    built-in defaults for any key not yet stored."""
    stored = {
        s.key[len(_PREFIX):]: s.value
        for s in db.scalars(
            select(AppSetting).where(AppSetting.key.in_([_PREFIX + k for k in SAMPLE_DEFAULT_KEYS]))
        )
        if s.key.startswith(_PREFIX)
    }
    return {
        key: (stored.get(key) or SAMPLE_DEFAULT_FALLBACKS[key])
        for key in SAMPLE_DEFAULT_KEYS
    }


def _validate(key: str, value: str) -> str:
    """Coerce/validate one incoming default value to its canonical stored form. Raises
    ValueError with a lab-readable message the API can surface as a 422."""
    if key in _BOOL_DEFAULT_KEYS:
        normalized, ok = parse_bool_field(value)
        if not ok or normalized is None:
            raise ValueError(f"{key} default must be True or False")
        return normalized
    # priority
    canonical = normalize_priority(value)
    if canonical is None:
        raise ValueError("priority default must be one of Standard, Medium, High")
    return canonical


def set_sample_defaults(db: Session, values: dict[str, str]) -> dict[str, str]:
    """Upsert the given sample defaults (only the keys present in `values` are touched).
    Does NOT commit — the caller owns the transaction. Returns the full current defaults."""
    for key, raw in values.items():
        if key not in SAMPLE_DEFAULT_FALLBACKS:
            raise ValueError(f"Unknown sample default '{key}'")
        stored_value = _validate(key, raw)
        _upsert(db, _PREFIX + key, stored_value)
    db.flush()
    return get_sample_defaults(db)


# --- Scheduling rules --------------------------------------------------------------------
# Global scheduling parameters (not per-sample defaults), each a lab-tunable knob surfaced in
# the Settings page. Namespaced so they never collide with other app_settings entries. The
# built-in constants (engine/constants.py) remain the fallback for a never-stored/unparseable
# value. Editable set:
#   insert_size_reuse_threshold_bp - a library whose insert_size_bp is <= this is kept on a
#     cell's first use by Auto Schedule and flagged if placed on a reuse.
#   day_start_hour                 - the default hour (UTC, 0-23) a run loads; seeds the grid's
#     load-time dial and the reuse-window day reference (services/cell_service).
#   default_movie_hours            - the movie length assumed when a sample's own is missing
#     (must be one of MOVIE_HOURS_CHOICES; the values themselves stay fixed).
#   movie_cell_position            - JSON map {movie_hours: within_tray_pos 0-3 or null=any}:
#     which carousel cell a movie length is confined to under Auto Schedule.
#   repeat_total_complex_ul        - the total cleaned complex (uL) made per sample; the Cell QC
#     "repeat from complex" readout derives leftover = total - loaded from it.
#   repeat_safe_min_ul             - the leftover cleaned complex (uL) at or above which a repeat
#     straight from complex is "safe"; below it the QC modal flags the repeat "at risk".
# The movie_* keys feed engine/constants.MovieRules / the day-start reads; the repeat_* keys feed
# the QC preview's volume readout. The getters below build them and the service layer passes them
# to their callers, keeping the engine DB-free - the pattern get_insert_size_reuse_threshold uses.
_SCHEDULING_PREFIX = "scheduling."


def _canonical_ul(n: float) -> str:
    """A volume stored as text without a needless trailing ".0" (so 24.0 -> "24", 12.5 stays
    "12.5") - keeps the stored value and the Settings input reading the way a user typed it."""
    return f"{n:g}"

# Built-in movie->cell-position map as canonical JSON: one entry per movie choice, absent
# restrictions written as null ("any"). e.g. {"12": 0, "24": null, "30": 3}.
_DEFAULT_MOVIE_CELL_POSITION_JSON = json.dumps({str(h): MOVIE_CELL_POSITION.get(h) for h in MOVIE_HOURS_CHOICES})

SCHEDULING_DEFAULT_FALLBACKS: dict[str, str] = {
    "insert_size_reuse_threshold_bp": str(DEFAULT_INSERT_SIZE_REUSE_THRESHOLD_BP),
    "day_start_hour": str(DAY_START_HOUR),
    "default_movie_hours": str(DEFAULT_MOVIE_HOURS),
    "movie_cell_position": _DEFAULT_MOVIE_CELL_POSITION_JSON,
    "repeat_total_complex_ul": _canonical_ul(DEFAULT_TOTAL_COMPLEX_UL),
    "repeat_safe_min_ul": _canonical_ul(DEFAULT_REPEAT_SAFE_MIN_UL),
}
SCHEDULING_KEYS: tuple[str, ...] = tuple(SCHEDULING_DEFAULT_FALLBACKS)


def get_scheduling_settings(db: Session) -> dict[str, str]:
    """The current scheduling settings, one entry per SCHEDULING_KEYS, falling back to the
    built-in default for any key not yet stored."""
    stored = {
        s.key[len(_SCHEDULING_PREFIX):]: s.value
        for s in db.scalars(
            select(AppSetting).where(AppSetting.key.in_([_SCHEDULING_PREFIX + k for k in SCHEDULING_KEYS]))
        )
    }
    return {key: (stored.get(key) or SCHEDULING_DEFAULT_FALLBACKS[key]) for key in SCHEDULING_KEYS}


def get_insert_size_reuse_threshold(db: Session) -> int:
    """The current small-insert threshold (bp) as an int, falling back to the built-in default
    for a never-stored or unparseable/non-positive value. Read by auto-fill/recalculate and
    passed into pack_cells so the pure engine never touches the DB."""
    raw = get_scheduling_settings(db)["insert_size_reuse_threshold_bp"]
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_INSERT_SIZE_REUSE_THRESHOLD_BP
    return value if value > 0 else DEFAULT_INSERT_SIZE_REUSE_THRESHOLD_BP


def get_day_start_hour(db: Session) -> int:
    """The configured default run start hour (UTC, 0-23), falling back to the built-in
    DAY_START_HOUR for a never-stored or out-of-range value. Read by the reuse-window day
    reference (services/cell_service) and returned to the frontend to seed the load-time dial."""
    raw = get_scheduling_settings(db)["day_start_hour"]
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return DAY_START_HOUR
    return value if 0 <= value <= 23 else DAY_START_HOUR


def get_default_movie_hours(db: Session) -> int:
    """The configured default movie length (h), falling back to the built-in DEFAULT_MOVIE_HOURS
    for a never-stored value or one that isn't a valid movie choice."""
    raw = get_scheduling_settings(db)["default_movie_hours"]
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_MOVIE_HOURS
    return value if value in MOVIE_HOURS_CHOICES else DEFAULT_MOVIE_HOURS


def get_movie_cell_position(db: Session) -> dict[int, int | None]:
    """The configured movie->cell-position rules as {movie_hours: within_tray_pos 0-3 or None}:
    which carousel cell each movie length is confined to under Auto Schedule (None = any). Always
    returns one entry per MOVIE_HOURS_CHOICES; falls back to the built-in MOVIE_CELL_POSITION for
    a corrupt/never-stored value."""
    raw = get_scheduling_settings(db)["movie_cell_position"]
    try:
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError
    except (TypeError, ValueError):
        return {h: MOVIE_CELL_POSITION.get(h) for h in MOVIE_HOURS_CHOICES}
    result: dict[int, int | None] = {}
    for h in MOVIE_HOURS_CHOICES:
        v = data.get(str(h))
        result[h] = v if isinstance(v, int) and not isinstance(v, bool) and 0 <= v < CELLS_PER_TRAY else None
    return result


def get_movie_rules(db: Session) -> MovieRules:
    """The configured movie-time rules bundled for the pure engine (pack_cells/fill_slots), the
    DB-free-engine pattern get_insert_size_reuse_threshold uses. Combines get_movie_cell_position
    with get_default_movie_hours."""
    return MovieRules(positions=get_movie_cell_position(db), default_hours=get_default_movie_hours(db))


def get_repeat_total_complex_ul(db: Session) -> float:
    """The configured total cleaned complex (uL) made per sample, falling back to the built-in
    default for a never-stored or non-positive value. Passed into the QC preview so the modal can
    show how much complex is left after loading."""
    raw = get_scheduling_settings(db)["repeat_total_complex_ul"]
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return DEFAULT_TOTAL_COMPLEX_UL
    return value if value > 0 else DEFAULT_TOTAL_COMPLEX_UL


def get_repeat_safe_min_ul(db: Session) -> float:
    """The configured leftover cleaned complex (uL) at/above which a repeat from complex is
    "safe", falling back to the built-in default for a never-stored or non-positive value."""
    raw = get_scheduling_settings(db)["repeat_safe_min_ul"]
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return DEFAULT_REPEAT_SAFE_MIN_UL
    return value if value > 0 else DEFAULT_REPEAT_SAFE_MIN_UL


def _validate_movie_cell_position(value: str) -> str:
    """Validate the incoming movie->cell-position JSON and return it re-serialized canonically
    (one entry per movie choice, restrictions as an int 0..CELLS_PER_TRAY-1, "any" as null)."""
    try:
        data = json.loads(value)
    except (TypeError, ValueError) as err:
        raise ValueError("Movie cell-position rules must be a valid mapping") from err
    if not isinstance(data, dict):
        raise ValueError("Movie cell-position rules must map each movie length to a cell or 'Any'")
    valid_keys = {str(h) for h in MOVIE_HOURS_CHOICES}
    for k in data:
        if str(k) not in valid_keys:
            raise ValueError(f"Unknown movie length '{k}' in cell-position rules")
    canonical: dict[str, int | None] = {}
    for h in MOVIE_HOURS_CHOICES:
        v = data.get(str(h))
        if v is None:
            canonical[str(h)] = None
            continue
        if isinstance(v, bool) or not isinstance(v, int) or not (0 <= v < CELLS_PER_TRAY):
            raise ValueError(f"Cell rule for {h} h must be one of cells 1-{CELLS_PER_TRAY}, or Any")
        canonical[str(h)] = v
    return json.dumps(canonical)


def _validate_scheduling(key: str, value: str) -> str:
    """Coerce/validate one incoming scheduling value to its canonical stored form (all stored as
    text). Raises ValueError with a lab-readable message the API surfaces as a 422."""
    if key == "insert_size_reuse_threshold_bp":
        try:
            n = int(str(value).strip())
        except (TypeError, ValueError) as err:
            raise ValueError("Insert size re-use threshold must be a whole number of base pairs") from err
        if n <= 0:
            raise ValueError("Insert size re-use threshold must be greater than 0")
        return str(n)
    if key == "day_start_hour":
        try:
            n = int(str(value).strip())
        except (TypeError, ValueError) as err:
            raise ValueError("Default run start hour must be a whole number of hours (0-23)") from err
        if not (0 <= n <= 23):
            raise ValueError("Default run start hour must be between 0 and 23")
        return str(n)
    if key == "default_movie_hours":
        try:
            n = int(str(value).strip())
        except (TypeError, ValueError) as err:
            raise ValueError("Default movie length must be a whole number of hours") from err
        if n not in MOVIE_HOURS_CHOICES:
            allowed = ", ".join(f"{h} h" for h in MOVIE_HOURS_CHOICES)
            raise ValueError(f"Default movie length must be one of {allowed}")
        return str(n)
    if key == "movie_cell_position":
        return _validate_movie_cell_position(value)
    if key in ("repeat_total_complex_ul", "repeat_safe_min_ul"):
        label = (
            "Total cleaned complex volume"
            if key == "repeat_total_complex_ul"
            else "Safe repeat-from-complex volume"
        )
        try:
            n = float(str(value).strip())
        except (TypeError, ValueError) as err:
            raise ValueError(f"{label} must be a number of microlitres") from err
        # Reject NaN/inf (a JSON number like 1e400 parses to inf) - stored "inf"/"nan" would
        # later break JSON-serialising every scheduling/QC read that returns it.
        if not math.isfinite(n) or n <= 0:
            raise ValueError(f"{label} must be greater than 0")
        return _canonical_ul(n)
    raise ValueError(f"Unknown scheduling setting '{key}'")


def set_scheduling_settings(db: Session, values: dict[str, str]) -> dict[str, str]:
    """Upsert the given scheduling settings (only the keys present in `values` are touched).
    Does NOT commit — the caller owns the transaction. Returns the full current settings."""
    for key, raw in values.items():
        if key not in SCHEDULING_DEFAULT_FALLBACKS:
            raise ValueError(f"Unknown scheduling setting '{key}'")
        stored_value = _validate_scheduling(key, raw)
        _upsert(db, _SCHEDULING_PREFIX + key, stored_value)
    db.flush()
    return get_scheduling_settings(db)


# --- Credit-email template ---------------------------------------------------------------
# The single email the app sends: the PacBio SMRT-cell credit request, generated from a
# credit case. Its four parts (to/cc/subject/body) are editable from the admin "Email
# template" panel and stored under the credit_email.* namespace. The subject/body may embed
# <angle-bracket> variables (e.g. "<sample name>") that the frontend fills from the failing
# cell's triggering use when it builds the mailto link — see frontend utils/creditEmail.ts,
# which owns the canonical token list. The backend only stores/returns the raw strings.
_CREDIT_EMAIL_PREFIX = "credit_email."

# Built-in defaults, used until the lab edits the template. These mirror the original
# hardcoded credit email, with the dynamic values replaced by variable tokens.
CREDIT_EMAIL_FALLBACKS: dict[str, str] = {
    "to": "Pacific Biosciences <support@pacificbiosciences.com>",
    "cc": "revio-updates@sanger.ac.uk",
    "subject": "SMRT Cell issue – <run>",
    "body": (
        "Cell issue on sample <sample name>, run <run>, <instrument>, <run date>.\n"
        "\n"
        "Please advise on how to proceed. If the cell will be credited, please can you "
        "confirm the number of acquisitions that are being credited.\n"
        "\n"
        "Based on the failure, we expect <reimbursement> acquisition(s) to be credited "
        "(the failed acquisition plus the cell's remaining acquisitions).\n"
        "\n"
        "Sample ID: <sample name>"
    ),
}
CREDIT_EMAIL_KEYS: tuple[str, ...] = tuple(CREDIT_EMAIL_FALLBACKS)


def get_credit_email(db: Session) -> dict[str, str]:
    """The current credit-email template (to/cc/subject/body), falling back to the built-in
    default for any part not yet stored. A stored-but-empty value is kept as-is (the lab may
    deliberately want an empty cc); only a never-stored key falls back."""
    stored = {
        s.key[len(_CREDIT_EMAIL_PREFIX):]: s.value
        for s in db.scalars(
            select(AppSetting).where(
                AppSetting.key.in_([_CREDIT_EMAIL_PREFIX + k for k in CREDIT_EMAIL_KEYS])
            )
        )
    }
    return {
        key: (stored[key] if key in stored and stored[key] is not None else CREDIT_EMAIL_FALLBACKS[key])
        for key in CREDIT_EMAIL_KEYS
    }


def set_credit_email(db: Session, values: dict[str, str]) -> dict[str, str]:
    """Upsert the given credit-email parts (only the keys present in `values` are touched).
    Does NOT commit — the caller owns the transaction. Returns the full current template.
    to/cc/subject are trimmed; body is kept verbatim (leading/trailing blank lines matter)."""
    for key, raw in values.items():
        if key not in CREDIT_EMAIL_FALLBACKS:
            raise ValueError(f"Unknown credit-email field '{key}'")
        stored_value = raw if key == "body" else raw.strip()
        _upsert(db, _CREDIT_EMAIL_PREFIX + key, stored_value)
    db.flush()
    return get_credit_email(db)


def _upsert(db: Session, full_key: str, value: str) -> None:
    """Insert or update one app_settings row. Does not flush/commit."""
    existing = db.get(AppSetting, full_key)
    if existing is None:
        db.add(AppSetting(key=full_key, value=value))
    else:
        existing.value = value
