"""Real-world run tracking: recording what actually happened cascades from Cycle down
to CellUse/Sample, and always recomputes Cell status from derive_cell_state() rather
than trusting a stale stored value."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.models.schedule import CellUse, Cycle
from app.models.audit import AuditLog
from app.services.cell_service import recompute_status
from app.timeutil import ensure_aware, utcnow


def update_cycle_status(db: Session, cycle: Cycle, status: str, at: datetime | None, actor: str | None) -> Cycle:
    at = ensure_aware(at) if at else utcnow()
    cycle.status = status

    if status == "running":
        cycle.actual_start_at = cycle.actual_start_at or at
        for cu in cycle.cell_uses:
            if cu.status == "planned":
                cu.status = "started"
                cu.started_at = cu.started_at or at
            if cu.sample is not None and cu.sample.status not in ("completed", "failed"):
                cu.sample.status = "in_progress"
            if cu.cell.first_use_started_at is None:
                cu.cell.first_use_started_at = at
    elif status == "completed":
        cycle.actual_end_at = cycle.actual_end_at or at
        for cu in cycle.cell_uses:
            if cu.status in ("planned", "started"):
                cu.status = "completed"
                cu.started_at = cu.started_at or at
                cu.completed_at = at
            if cu.sample is not None and cu.sample.status not in ("completed", "failed"):
                cu.sample.status = "completed"
            if cu.cell.first_use_started_at is None:
                cu.cell.first_use_started_at = cu.started_at or at
    elif status == "aborted":
        cycle.actual_end_at = cycle.actual_end_at or at

    for cu in cycle.cell_uses:
        recompute_status(cu.cell, at)

    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="update_cycle_status",
            entity_type="cycle",
            entity_id=cycle.id,
            details_json={"status": status},
        )
    )
    db.commit()
    db.refresh(cycle)
    return cycle


def update_cell_use_status(
    db: Session, cell_use: CellUse, status: str, at: datetime | None, notes: str | None, actor: str | None
) -> CellUse:
    at = ensure_aware(at) if at else utcnow()
    cell_use.status = status

    if status == "started":
        cell_use.started_at = cell_use.started_at or at
        if cell_use.cell.first_use_started_at is None:
            cell_use.cell.first_use_started_at = at
        if cell_use.sample is not None and cell_use.sample.status not in ("completed", "failed"):
            cell_use.sample.status = "in_progress"
    elif status in ("completed", "failed"):
        cell_use.started_at = cell_use.started_at or at
        cell_use.completed_at = at
        if notes:
            cell_use.outcome_notes = notes
        if cell_use.sample is not None:
            cell_use.sample.status = "completed" if status == "completed" else "failed"
        if cell_use.cell.first_use_started_at is None:
            cell_use.cell.first_use_started_at = cell_use.started_at or at

    recompute_status(cell_use.cell, at)

    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="update_cell_use_status",
            entity_type="cell_use",
            entity_id=cell_use.id,
            details_json={"status": status, "notes": notes},
        )
    )
    db.commit()
    db.refresh(cell_use)
    return cell_use
