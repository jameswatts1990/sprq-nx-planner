"""Real-world run tracking: recording what actually happened cascades from Cycle down
to CellUse/Sample, and always recomputes Cell status from derive_cell_state() rather
than trusting a stale stored value."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.schedule import CellUse, Cycle
from app.models.audit import AuditLog
from app.services.cell_service import recompute_status, run_has_started
from app.timeutil import ensure_aware, utcnow

# Legal cycle status transitions. "Unlock" (running -> planned) is the only way back to
# planned, so a completed/aborted run can never silently discard its recorded per-CellUse
# outcomes by being reverted.
ALLOWED_CYCLE_TRANSITIONS = {
    "planned": {"running"},
    "running": {"completed", "aborted", "planned"},
    "completed": set(),
    "aborted": set(),
}


def update_cycle_status(db: Session, cycle: Cycle, status: str, at: datetime | None, actor: str | None) -> Cycle:
    if status not in ALLOWED_CYCLE_TRANSITIONS.get(cycle.status, set()):
        raise ValueError(f"Illegal cycle transition: {cycle.status} -> {status}.")

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
            if cu.status in ("planned", "started"):
                cu.status = "aborted"
                cu.started_at = cu.started_at or at
                cu.completed_at = at
                # Aborted is a run/instrument problem, not the sample's - straight back to
                # backlog for a fresh attempt, matching the per-CellUse Mark Aborted action
                # (see update_cell_use_status below). Gated to uses actually transitioning
                # here, unlike the sibling "completed" cascade above - a cell_use already
                # terminal (e.g. a stopped-cell's cancelled marker) may share a sample_id
                # with an unrelated, since-rescheduled placement elsewhere and must not have
                # its sample status clobbered by this cycle's own outcome.
                if cu.sample is not None and cu.sample.status not in ("completed", "failed"):
                    cu.sample.status = "backlog"
            if cu.cell.first_use_started_at is None:
                cu.cell.first_use_started_at = cu.started_at or at
    elif status == "planned":
        # Unlock: undo the running-cascade. Only reachable from "running", so no recorded
        # completed/aborted outcome is ever discarded.
        cycle.actual_start_at = None
        cycle.actual_end_at = None
        for cu in cycle.cell_uses:
            if cu.status == "started":
                cu.status = "planned"
                cu.started_at = None
            if cu.sample is not None and cu.sample.status == "in_progress":
                cu.sample.status = "scheduled"
        # Recompute each touched cell's first_use_started_at from its remaining real starts -
        # the cell may still have started/completed uses from other runs.
        for cell in {cu.cell for cu in cycle.cell_uses if cu.cell is not None}:
            started = [ensure_aware(cu.started_at) for cu in cell.cell_uses if cu.started_at is not None]
            cell.first_use_started_at = min(started) if started else None
            if cell.first_use_started_at is None:
                cell.window_breached = False

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
    if cell_use.status == "cancelled":
        raise ValueError("This placement was cancelled when its cell was stopped and can't be modified.")
    # Mirrors the frontend's canRecordQcOutcome gate (cellUseQc.ts) server-side - Mark
    # Failed/Mark Aborted are only meaningful once the instrument has actually committed to
    # this run (see run_has_started's docstring); without this, a direct API call could
    # record a QC outcome on a use that hasn't happened yet.
    if status in ("failed", "aborted") and not run_has_started(cell_use):
        raise ValueError("Cannot record a QC outcome before this use's run has started.")
    at = ensure_aware(at) if at else utcnow()
    # Snapshot of everything this call is about to overwrite, so a mistaken Mark
    # Failed/Aborted can be undone later (see undo_cell_use_status) without guessing what
    # the use looked like beforehand.
    before = {
        "status": cell_use.status,
        "started_at": cell_use.started_at.isoformat() if cell_use.started_at else None,
        "completed_at": cell_use.completed_at.isoformat() if cell_use.completed_at else None,
        "outcome_notes": cell_use.outcome_notes,
        "sample_status": cell_use.sample.status if cell_use.sample is not None else None,
    }
    cell_use.status = status

    if status == "started":
        cell_use.started_at = cell_use.started_at or at
        if cell_use.cell.first_use_started_at is None:
            cell_use.cell.first_use_started_at = at
        if cell_use.sample is not None and cell_use.sample.status not in ("completed", "failed"):
            cell_use.sample.status = "in_progress"
    elif status in ("completed", "failed", "aborted"):
        cell_use.started_at = cell_use.started_at or at
        cell_use.completed_at = at
        if notes:
            cell_use.outcome_notes = notes
        if cell_use.sample is not None:
            if status == "completed":
                cell_use.sample.status = "completed"
            elif status == "failed":
                cell_use.sample.status = "failed"
            else:
                # Aborted is a run/instrument problem, not a sample or cell-quality one -
                # the sample goes straight back to the backlog for a fresh attempt rather
                # than through the Failed->Requeue detour (see cell_service.has_failed_use,
                # which deliberately doesn't count "aborted" toward the PacBio credit flow).
                cell_use.sample.status = "backlog"
        if cell_use.cell.first_use_started_at is None:
            cell_use.cell.first_use_started_at = cell_use.started_at or at

    recompute_status(cell_use.cell, at)

    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="update_cell_use_status",
            entity_type="cell_use",
            entity_id=cell_use.id,
            details_json={"status": status, "notes": notes, "before": before},
        )
    )
    db.commit()
    db.refresh(cell_use)
    return cell_use


def undo_cell_use_status(db: Session, cell_use: CellUse, actor: str | None) -> CellUse:
    """Reverse a mistaken Mark Failed/Mark Aborted - e.g. the wrong slot was flagged and
    the real problem cell still needs to be marked. Only these two QC verdicts are
    reachable here: "completed" is never set through this per-use action (only via a
    cycle's own completion), and "cancelled" (Stop cell's "Blocked" marker) has its own
    undo_stop_cell, since it cascades from the Cell, not this one use.

    Restores exactly the pre-verdict snapshot captured by update_cell_use_status,
    including reviving cell_use.status back to "planned"/"started" - which only makes
    sense if the sample is still sitting in the exact post-verdict state (failed->sample
    "failed", aborted->sample "backlog") that verdict left it in. If it's since been
    requeued, rescheduled onto a fresh placement elsewhere, or otherwise moved on,
    reviving this use would double-book that sample against wherever it landed - so this
    hard-blocks instead of silently reverting only part of the original cascade."""
    if cell_use.status not in ("failed", "aborted"):
        raise ValueError("Only a Failed or Aborted use can be undone.")

    last_action = db.scalars(
        select(AuditLog)
        .where(
            AuditLog.entity_type == "cell_use",
            AuditLog.entity_id == cell_use.id,
            AuditLog.action == "update_cell_use_status",
        )
        .order_by(AuditLog.id.desc())
        .limit(1)
    ).first()
    if last_action is None or "before" not in last_action.details_json:
        raise ValueError("No recorded QC action found to undo.")

    reverted_from = cell_use.status
    before = last_action.details_json["before"]
    expected_sample_status = "failed" if reverted_from == "failed" else "backlog"
    if cell_use.sample is not None and cell_use.sample.status != expected_sample_status:
        raise ValueError("This use's sample has since moved on (requeued or rescheduled) - undo is no longer possible.")

    cell_use.status = before["status"]
    cell_use.started_at = ensure_aware(datetime.fromisoformat(before["started_at"])) if before["started_at"] else None
    cell_use.completed_at = (
        ensure_aware(datetime.fromisoformat(before["completed_at"])) if before["completed_at"] else None
    )
    cell_use.outcome_notes = before["outcome_notes"]
    if cell_use.sample is not None and before["sample_status"] is not None:
        cell_use.sample.status = before["sample_status"]

    recompute_status(cell_use.cell, utcnow())

    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="undo_cell_use_status",
            entity_type="cell_use",
            entity_id=cell_use.id,
            details_json={"reverted_from": reverted_from, "restored_status": before["status"]},
        )
    )
    db.commit()
    db.refresh(cell_use)
    return cell_use
