"""Real-world run tracking: recording what actually happened cascades from Cycle down
to CellUse/Sample, and always recomputes Cell status from derive_cell_state() rather
than trusting a stale stored value."""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.schedule import CellUse, Cycle, RunBatch
from app.models.audit import AuditLog
from app.services.cell_service import recompute_status, run_has_started
from app.services.cell_timing import run_breakout_offsets
from app.timeutil import ensure_aware, utcnow

# Legal plate/run status transitions. "Unlock" (running -> planned) is the only way back to
# planned, so a completed/aborted run can never silently discard its recorded per-CellUse
# outcomes by being reverted.
ALLOWED_CYCLE_TRANSITIONS = {
    "planned": {"running"},
    "running": {"completed", "aborted", "planned"},
    "completed": set(),
    "aborted": set(),
}


def _apply_cycle_status(cycle: Cycle, status: str, at: datetime, offsets: dict[int, float]) -> None:
    """Apply one plate's status transition and its cascade down to cell_uses / samples /
    the cell's 108h-window anchor (first_use_started_at). No commit/audit - update_run_status
    wraps this across all of a run's plates (both are loaded in one session, so they move
    together).

    ``offsets`` maps cell_use id -> hours after the run's load time that cell actually breaks
    out (from cell_timing.run_breakout_offsets): the instrument staggers a tray's cells ~2h apart
    and a same-session second tray ~28h later, so each cell's recorded start and its 108h reuse
    window anchor at *its own* breakout, not one shared tray timestamp (see
    docs/pacbio-sprq-nx-scheduling-reference.md, "Per-cell breakout, PPA capacity...")."""

    def breakout(cu: CellUse) -> datetime:
        return at + timedelta(hours=offsets.get(cu.id, 0.0))

    cycle.status = status
    if status == "running":
        cycle.actual_start_at = cycle.actual_start_at or at
        for cu in cycle.cell_uses:
            if cu.status == "planned":
                cu.status = "started"
                cu.started_at = cu.started_at or breakout(cu)
            if cu.sample is not None and cu.sample.status not in ("completed", "failed"):
                cu.sample.status = "in_progress"
            if cu.cell.first_use_started_at is None:
                cu.cell.first_use_started_at = cu.started_at or breakout(cu)
    elif status == "completed":
        cycle.actual_end_at = cycle.actual_end_at or at
        for cu in cycle.cell_uses:
            if cu.status in ("planned", "started"):
                cu.status = "completed"
                cu.started_at = cu.started_at or breakout(cu)
                cu.completed_at = at
            if cu.sample is not None and cu.sample.status not in ("completed", "failed"):
                cu.sample.status = "completed"
            if cu.cell.first_use_started_at is None:
                cu.cell.first_use_started_at = cu.started_at or breakout(cu)
    elif status == "aborted":
        cycle.actual_end_at = cycle.actual_end_at or at
        for cu in cycle.cell_uses:
            if cu.status in ("planned", "started"):
                cu.status = "aborted"
                cu.started_at = cu.started_at or breakout(cu)
                cu.completed_at = at
                # Aborted is a run/instrument problem, not the sample's - straight back to
                # backlog for a fresh attempt. Gated to uses actually transitioning here: a
                # cell_use already terminal (e.g. a stopped-cell's cancelled marker) may share
                # a sample_id with an unrelated, since-rescheduled placement and must not have
                # its sample status clobbered by this run's own outcome.
                if cu.sample is not None and cu.sample.status not in ("completed", "failed"):
                    cu.sample.status = "backlog"
            if cu.cell.first_use_started_at is None:
                cu.cell.first_use_started_at = cu.started_at or breakout(cu)
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


def update_run_status(
    db: Session, run_batch: RunBatch, status: str, at: datetime | None, actor: str | None, run_name: str | None = None
) -> RunBatch:
    """Move a whole run (all its plates) through the load lifecycle - Confirm loaded
    (planned->running), Complete/Abort, or Unlock (running->planned). A run's plates are
    loaded in one session, so they transition together; run_name (Traction ID) is run-level
    and set at Confirm loaded."""
    cycles = list(run_batch.cycles)
    for c in cycles:
        if c.status != status and status not in ALLOWED_CYCLE_TRANSITIONS.get(c.status, set()):
            raise ValueError(f"Illegal run transition: plate {c.plate_index} is {c.status} -> {status}.")

    at = ensure_aware(at) if at else utcnow()
    if status == "running" and run_name is not None:
        # Only settable at lock time; blank/whitespace clears it. Untouched on every other
        # transition (Unlock included) so a name already given isn't silently discarded.
        run_batch.run_name = run_name.strip() or None

    # Per-cell breakout offsets (hours after load) so each cell's start/108h window anchors at
    # its own staggered breakout, not one shared tray timestamp - computed once over the whole run.
    offsets = run_breakout_offsets(run_batch)
    for c in cycles:
        if c.status != status:
            _apply_cycle_status(c, status, at, offsets)

    for c in cycles:
        for cu in c.cell_uses:
            recompute_status(cu.cell, at)

    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="update_run_status",
            entity_type="run_batch",
            entity_id=run_batch.id,
            details_json={"status": status},
        )
    )
    db.commit()
    db.refresh(run_batch)
    return run_batch


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
    # Anchor this use's start / 108h window at its own staggered breakout (load + ~2h·position,
    # a second tray ~28h later), consistent with the whole-run Confirm-loaded path above.
    breakout = at + timedelta(hours=run_breakout_offsets(cell_use.cycle.run_batch).get(cell_use.id, 0.0))

    if status == "started":
        cell_use.started_at = cell_use.started_at or breakout
        if cell_use.cell.first_use_started_at is None:
            cell_use.cell.first_use_started_at = cell_use.started_at or breakout
        if cell_use.sample is not None and cell_use.sample.status not in ("completed", "failed"):
            cell_use.sample.status = "in_progress"
    elif status in ("completed", "failed", "aborted"):
        cell_use.started_at = cell_use.started_at or breakout
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
            cell_use.cell.first_use_started_at = cell_use.started_at or breakout

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
