"""The one way to write an audit-trail row (models/audit.py) and to describe what an edit changed.
The Activity page reads these rows back through GET /api/audit-log, so an edit's `details_json` is
`diff(before, after)` - {field: {"from": old, "to": new}} for each field that changed - and the
page renders it as "Priority: High → Urgent"."""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from sqlalchemy.orm import Session

from app.models.audit import AuditLog


def log_action(
    db: Session,
    actor: str | None,
    action: str,
    entity_type: str,
    entity_id: int | None,
    details: Mapping[str, Any] | None = None,
) -> AuditLog:
    """Add (not commit) one audit row - the caller's transaction commits it with the change."""
    row = AuditLog(
        actor=actor or "unknown",
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        details_json=dict(details or {}),
    )
    db.add(row)
    return row


def diff(before: Mapping[str, Any], after: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    """The fields of two snapshots (same keys) that differ, as {field: {"from", "to"}}. Empty when
    nothing changed - callers skip the audit row then, so a no-op save leaves no trace."""
    return {k: {"from": before[k], "to": after[k]} for k in before if before[k] != after[k]}
