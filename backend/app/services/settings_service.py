"""Read/write app-wide sample defaults (the loading options pre-filled on new samples).

Defaults are applied when a backlog sample is created (manual add or CSV import) and any
of these fields is left unspecified — an explicitly provided value (including an explicit
False) always wins. The manual add form also reads these to pre-fill its controls."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.engine.constants import (
    DEFAULT_INSERT_SIZE_REUSE_THRESHOLD_BP,
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
# Global scheduling parameters (not per-sample defaults). Currently just the insert-size
# reuse threshold: a library whose insert_size_bp is <= this value is kept on a cell's first
# use by Auto Schedule and flagged if placed on a reuse (see engine/packing.py and
# docs/pacbio-sprq-nx-scheduling-reference.md). Namespaced so it never collides with other
# app_settings entries.
_SCHEDULING_PREFIX = "scheduling."

SCHEDULING_DEFAULT_FALLBACKS: dict[str, str] = {
    "insert_size_reuse_threshold_bp": str(DEFAULT_INSERT_SIZE_REUSE_THRESHOLD_BP),
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


def _validate_scheduling(key: str, value: str) -> str:
    """Coerce/validate one incoming scheduling value to its canonical stored form (a positive
    integer, stored as text). Raises ValueError with a lab-readable message the API surfaces
    as a 422."""
    if key == "insert_size_reuse_threshold_bp":
        try:
            n = int(str(value).strip())
        except (TypeError, ValueError) as err:
            raise ValueError("Insert size re-use threshold must be a whole number of base pairs") from err
        if n <= 0:
            raise ValueError("Insert size re-use threshold must be greater than 0")
        return str(n)
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
