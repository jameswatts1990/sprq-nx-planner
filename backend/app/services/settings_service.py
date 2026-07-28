"""Read/write app-wide sample defaults (the loading options pre-filled on new samples).

Defaults are applied when a backlog sample is created (manual add or CSV import) and any
of these fields is left unspecified — an explicitly provided value (including an explicit
False) always wins. The manual add form also reads these to pre-fill its controls."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.engine.constants import PRIORITY_STANDARD, normalize_priority
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
        full_key = _PREFIX + key
        existing = db.get(AppSetting, full_key)
        if existing is None:
            db.add(AppSetting(key=full_key, value=stored_value))
        else:
            existing.value = stored_value
    db.flush()
    return get_sample_defaults(db)
