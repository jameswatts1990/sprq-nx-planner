"""Cell QC: the unified Fail / Fail-and-Stop / Retire flow and its tray-queue reconciliation.

Replaces the old scattered per-use Mark Failed, whole-cell stop_cell (+ _reallocate_bumped_uses)
and retire_cell. SPRQ-Nx loading is a continuous queue - samples load in plate order and each
takes the next eligible available cell-use - so a failure (only ever known AFTER a run) removes
cell-use opportunities and every downstream sample shifts forward onto the next surviving cell,
displacing the tail. We can't reshuffle a run that already happened, so we MIRROR what the
instrument did: recompute the real sample->cell assignments, flag samples that ran on a
different cell than planned, and highlight barcode clashes the shift created.

See docs/pacbio-sprq-nx-scheduling-reference.md and the plan in
.claude/plans/fail-qc-review-desired-zany-stream.md. The re-zip writes actual cell assignments
directly (NOT via place_sample/move_sample) - it records physical reality and must be able to
represent a barcode clash to flag it, rather than reject it the way normal placement would.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.engine.constants import (
    DEFAULT_REPEAT_SAFE_MIN_UL,
    DEFAULT_TOTAL_COMPLEX_UL,
    within_tray_pos,
)
from app.engine.packing import RECOVERABLE_PRIORITY, REPEATABLE_PRIORITY
from app.models.audit import AuditLog
from app.models.cell import Cell
from app.models.sample import Sample
from app.models.schedule import CellUse
from app.models.topup import SampleTopup
from app.schemas.qc import (
    DISPOSITIONS,
    QC_VERDICTS,
    AffectedSampleOut,
    QcCommitOut,
    QcPreviewOut,
    QcUndoOut,
)
from app.schemas.topup import SampleTopupOut
from app.services.cell_service import (
    active_uses,
    recompute_status,
    run_has_started,
    serialize_cell,
    use_sort_key,
    use_run_date,
)
from app.timeutil import ensure_aware, utcnow

# Terminal (stop/retire) verdicts trigger the tray re-zip; plain "fail" never shifts.
_SHIFT_VERDICTS = ("fail_and_stop", "retire")


# --------------------------------------------------------------------------------------
# Recompute (pure - no mutation). Shared by preview and commit.
# --------------------------------------------------------------------------------------


@dataclass
class _RowPlan:
    """The post-re-zip fate of one loading-queue acquisition (a CellUse row). The row keeps
    its own well and day; only which physical cell backs it may change."""

    row: CellUse
    old_cell_id: int
    new_cell: Cell | None  # None => displaced (no surviving cell-use left)
    reassigned: bool
    clash: bool


@dataclass
class _Recompute:
    lost_use: CellUse | None  # the failed acquisition (fail / fail_and_stop); its sample is lost
    plans: list[_RowPlan] = field(default_factory=list)  # one per non-lost row, loading order


def _loading_key(cu: CellUse) -> tuple[date, int, int]:
    """Order acquisitions the way the instrument loads them: by acquire day, then loading-well
    position within the day (A->D). The stable insertion-id tie-break keeps two rows that would
    otherwise compare equal deterministic."""
    acquire = use_run_date(cu) or date.min
    return (acquire, within_tray_pos(cu.well), cu.id)


def _tray_rows(cell: Cell) -> list[CellUse]:
    """Every non-cancelled acquisition across the cell's whole physical tray (its 4 cells),
    in loading order - the queue the re-zip operates on. A cell with no tray (legacy/bootstrap)
    has only its own uses to consider."""
    cells = cell.tray.cells if cell.tray is not None else [cell]
    rows = [cu for c in cells for cu in c.cell_uses if cu.status != "cancelled"]
    return sorted(rows, key=_loading_key)


def _planned_use_number(cu: CellUse) -> int:
    """1-based Use N of this acquisition's cell in the pre-QC plan (for display)."""
    cell = cu.cell
    if cell is None:
        return 1
    ordered = sorted(active_uses(cell), key=use_sort_key)
    return ordered.index(cu) + 1 if cu in ordered else len(ordered) + 1


def _compute(cell: Cell, verdict: str, trigger: CellUse | None) -> _Recompute:
    """Re-zip the tray's loading queue with `cell` removed from the pool. Pure: computes each
    row's new backing cell without mutating anything, so preview and commit agree exactly."""
    lost_use = trigger if verdict in ("fail", "fail_and_stop") else None

    # Plain Fail never shifts - the cell is physically fine and keeps its other uses; only the
    # failed acquisition's sample is affected.
    if verdict == "fail":
        return _Recompute(lost_use=lost_use, plans=[])

    all_rows = _tray_rows(cell)
    lost_rows = {lost_use.id} if lost_use is not None else set()
    # A stopped/retired cell contributes NO future cell-uses: its planned rows leave the pool.
    # Its already-run (completed/started) rows stay - stopping doesn't undo an earlier success.
    removed_rows = set(lost_rows)
    for row in all_rows:
        if row.cell_id == cell.id and row.status == "planned":
            removed_rows.add(row.id)

    non_lost_rows = [r for r in all_rows if r.id not in lost_rows]
    surviving_slots = [r for r in all_rows if r.id not in removed_rows]

    plans: list[_RowPlan] = []
    # Group post-shift barcodes per new cell so a reassignment onto a cell that already burned a
    # clashing barcode is flagged. Built from the final assignment, so it reflects reality.
    new_cell_barcodes: dict[int, list[tuple[int, set[str]]]] = {}
    for i, row in enumerate(non_lost_rows):
        new_cell = surviving_slots[i].cell if i < len(surviving_slots) else None
        reassigned = new_cell is not None and new_cell.id != row.cell_id
        plans.append(_RowPlan(row=row, old_cell_id=row.cell_id, new_cell=new_cell, reassigned=reassigned, clash=False))
        if new_cell is not None:
            new_cell_barcodes.setdefault(new_cell.id, []).append((row.id, set(row.barcode_list)))

    for plan in plans:
        if plan.new_cell is None:
            continue
        others = [bcs for (rid, bcs) in new_cell_barcodes.get(plan.new_cell.id, []) if rid != plan.row.id]
        burned_by_others: set[str] = set().union(*others) if others else set()
        plan.clash = bool(set(plan.row.barcode_list) & burned_by_others)

    return _Recompute(lost_use=lost_use, plans=plans)


# --------------------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------------------


def _resolve_trigger(cell: Cell, verdict: str, cell_use_id: int | None) -> CellUse | None:
    if verdict not in QC_VERDICTS:
        raise ValueError(f"Unknown QC verdict '{verdict}'. Valid: {', '.join(QC_VERDICTS)}")
    if cell.status in ("retired", "stopped"):
        raise ValueError(f"Cell is already {cell.status}.")

    if verdict in ("fail", "fail_and_stop"):
        if cell_use_id is None:
            raise ValueError("A cell_use_id is required for Fail / Fail and Stop.")
        trigger = next((cu for cu in cell.cell_uses if cu.id == cell_use_id), None)
        if trigger is None:
            raise ValueError("That use does not belong to this cell.")
        if trigger.status not in ("planned", "started"):
            raise ValueError(f"Cannot run QC from a use that is already {trigger.status}.")
        if not run_has_started(trigger):
            raise ValueError("Cannot fail a use before its run has started.")
        return trigger

    # Retire: optional anchor. With one, its later planned uses go; without, all planned uses go.
    # (Retire never fails the current use and never requires the run to have started.)
    if cell_use_id is not None:
        trigger = next((cu for cu in cell.cell_uses if cu.id == cell_use_id), None)
        if trigger is None:
            raise ValueError("That use does not belong to this cell.")
        return trigger
    return None


# --------------------------------------------------------------------------------------
# Preview (no mutation)
# --------------------------------------------------------------------------------------


def _affected_from_recompute(rc: _Recompute) -> list[AffectedSampleOut]:
    out: list[AffectedSampleOut] = []

    def entry(cu: CellUse, *, role: str, actual_cell: Cell | None, reassigned: bool, clash: bool, required: bool) -> None:
        run_batch = cu.cycle.run_batch if cu.cycle else None
        out.append(
            AffectedSampleOut(
                sample_id=cu.sample_id if cu.sample_id is not None else -1,
                pool_id=cu.sample.pool_id if cu.sample else None,
                barcodes=cu.barcode_list,
                sanger_ids=list(cu.sample.sanger_ids or []) if cu.sample else [],
                cleaned_complex_volume=cu.sample.cleaned_complex_volume if cu.sample else None,
                cell_use_id=cu.id,
                use_number=_planned_use_number(cu),
                run_date=use_run_date(cu),
                instrument_serial=(run_batch.instrument.serial_number if run_batch and run_batch.instrument else None),
                plate_index=cu.cycle.plate_index if cu.cycle else None,
                well=cu.well,
                planned_cell_code=cu.cell.code if cu.cell else None,
                actual_cell_code=actual_cell.code if actual_cell else None,
                role=role,
                reassigned=reassigned,
                barcode_clash=clash,
                disposition_required=required,
            )
        )

    if rc.lost_use is not None and rc.lost_use.sample_id is not None:
        entry(rc.lost_use, role="failed", actual_cell=rc.lost_use.cell, reassigned=False, clash=False, required=True)
    for plan in rc.plans:
        if plan.row.sample_id is None:
            continue
        if plan.new_cell is None:
            entry(plan.row, role="displaced", actual_cell=None, reassigned=False, clash=False, required=True)
        elif plan.reassigned:
            entry(plan.row, role="reassigned", actual_cell=plan.new_cell, reassigned=True, clash=plan.clash, required=False)
    return out


def preview_qc(
    cell: Cell,
    verdict: str,
    cell_use_id: int | None,
    *,
    total_complex_ul: float = DEFAULT_TOTAL_COMPLEX_UL,
    repeat_safe_min_ul: float = DEFAULT_REPEAT_SAFE_MIN_UL,
) -> QcPreviewOut:
    trigger = _resolve_trigger(cell, verdict, cell_use_id)
    rc = _compute(cell, verdict, trigger)
    affected = _affected_from_recompute(rc)
    requires = any(a.disposition_required for a in affected)
    return QcPreviewOut(
        verdict=verdict,
        cell_use_id=cell_use_id,
        affected_samples=affected,
        requires_disposition=requires,
        total_complex_ul=total_complex_ul,
        repeat_safe_min_ul=repeat_safe_min_ul,
    )


# --------------------------------------------------------------------------------------
# Commit (atomic)
# --------------------------------------------------------------------------------------


def commit_qc(
    db: Session,
    cell: Cell,
    *,
    verdict: str,
    cell_use_id: int | None,
    reason: str | None,
    dispositions: dict[int, str],
    actor: str | None,
) -> QcCommitOut:
    trigger = _resolve_trigger(cell, verdict, cell_use_id)
    rc = _compute(cell, verdict, trigger)
    affected = _affected_from_recompute(rc)

    for sid, disp in dispositions.items():
        if disp not in DISPOSITIONS:
            raise ValueError(f"Unknown disposition '{disp}'. Valid: {', '.join(DISPOSITIONS)}")
    required_ids = {a.sample_id for a in affected if a.disposition_required}
    optional_ids = {a.sample_id for a in affected if not a.disposition_required}
    missing = required_ids - set(dispositions)
    if missing:
        raise ValueError(f"A disposition is required for every affected sample; missing: {sorted(missing)}")
    extra = set(dispositions) - required_ids - optional_ids
    if extra:
        raise ValueError(f"Disposition given for sample(s) not affected: {sorted(extra)}")

    at = utcnow()
    audit_uses: dict[str, dict] = {}
    audit_samples: dict[str, dict] = {}

    def snapshot_use(cu: CellUse) -> None:
        audit_uses[str(cu.id)] = {
            "prior_status": cu.status,
            "prior_started_at": cu.started_at.isoformat() if cu.started_at else None,
            "prior_completed_at": cu.completed_at.isoformat() if cu.completed_at else None,
            "prior_outcome_notes": cu.outcome_notes,
            "prior_cell_id": cu.cell_id,
            "prior_reassigned_from": cu.reassigned_from_cell_id,
        }

    # 1. The failed acquisition (fail / fail_and_stop): mark it failed, stays on its own cell.
    if rc.lost_use is not None:
        snapshot_use(rc.lost_use)
        rc.lost_use.started_at = rc.lost_use.started_at or at
        rc.lost_use.completed_at = at
        if reason:
            rc.lost_use.outcome_notes = reason
        rc.lost_use.status = "failed"

    # 2. Re-zip: reassign each shifted acquisition's backing cell; cancel the displaced tail.
    reassigned_ids: list[int] = []
    clash_ids: list[int] = []
    displaced_uses: list[CellUse] = []
    touched_cell_ids: set[int] = set()
    for plan in rc.plans:
        if plan.new_cell is None:
            snapshot_use(plan.row)
            plan.row.status = "cancelled"
            displaced_uses.append(plan.row)
            continue
        if plan.reassigned:
            snapshot_use(plan.row)
            plan.row.reassigned_from_cell_id = plan.old_cell_id
            plan.row.cell = plan.new_cell
            touched_cell_ids.add(plan.old_cell_id)
            touched_cell_ids.add(plan.new_cell.id)
            reassigned_ids.append(plan.row.id)
            if plan.clash:
                clash_ids.append(plan.row.id)

    # 3. Cell status.
    prior_cell = {
        "prior_status": cell.status,
        "prior_stopped_at": cell.stopped_at.isoformat() if cell.stopped_at else None,
        "prior_stopped_reason": cell.stopped_reason,
    }
    if verdict == "fail_and_stop":
        cell.status = "stopped"
        cell.stopped_at = at
        cell.stopped_reason = reason
    elif verdict == "retire":
        cell.status = "retired"
        cell.stopped_at = at
        cell.stopped_reason = reason

    # 4. Per-sample disposition (authoritative for sample.status - a separate pass from use
    #    status above). Covers required samples (failed + displaced) and any optionally escalated.
    failed_sample_ids: list[int] = []
    displaced_sample_ids: list[int] = []
    backlog_sample_ids: list[int] = []
    created_topup_ids: list[int] = []
    by_sample = {a.sample_id: a for a in affected}
    for sid, disp in dispositions.items():
        sample = db.get(Sample, sid)
        if sample is None:
            continue
        audit_samples[str(sid)] = {
            "disposition": disp,
            "prior_status": sample.status,
            "prior_priority": sample.priority,
            "prior_qc_disposition": sample.qc_disposition,
            "via_cell_use_id": by_sample[sid].cell_use_id if sid in by_sample else None,
            "topup_id": None,
        }
        if disp == "lost":
            sample.status = "failed"
            topup = SampleTopup(
                sample_id=sample.id,
                source_cell_use_id=by_sample[sid].cell_use_id if sid in by_sample else None,
                note=reason,
                created_by=actor or "unknown",
            )
            db.add(topup)
            db.flush()
            created_topup_ids.append(topup.id)
            audit_samples[str(sid)]["topup_id"] = topup.id
        else:  # repeatable_complex / repeatable / recoverable - all return to the backlog
            sample.status = "backlog"
            # The two repeat pathways (from complex, from library) share Repeatable(0); only
            # "recoverable" (data recoverable) gets Recoverable(0). qc_disposition keeps the
            # exact pathway so the Backlog's Recoverable section and reporting can tell them apart.
            sample.priority = RECOVERABLE_PRIORITY if disp == "recoverable" else REPEATABLE_PRIORITY
            sample.qc_disposition = disp
            backlog_sample_ids.append(sid)

    for a in affected:
        if a.role == "failed":
            failed_sample_ids.append(a.sample_id)
        elif a.role == "displaced":
            displaced_sample_ids.append(a.sample_id)

    db.flush()
    # Refresh the cells whose use set changed so their derived status/capacity is current.
    recompute_status(cell, at)
    for cid in touched_cell_ids:
        sib = db.get(Cell, cid)
        if sib is not None:
            db.refresh(sib, attribute_names=["cell_uses"])
            recompute_status(sib, at)

    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="qc_commit",
            entity_type="cell",
            entity_id=cell.id,
            details_json={
                "verdict": verdict,
                "reason": reason,
                "cell": prior_cell,
                "uses": audit_uses,
                "samples": audit_samples,
            },
        )
    )
    db.commit()
    db.refresh(cell)
    db.refresh(cell, attribute_names=["cell_uses"])
    return QcCommitOut(
        cell=serialize_cell(cell),
        failed_sample_ids=failed_sample_ids,
        displaced_sample_ids=displaced_sample_ids,
        reassigned_cell_use_ids=reassigned_ids,
        clash_cell_use_ids=clash_ids,
        backlog_sample_ids=backlog_sample_ids,
        created_topup_ids=created_topup_ids,
    )


# --------------------------------------------------------------------------------------
# Undo
# --------------------------------------------------------------------------------------


def undo_qc(db: Session, cell: Cell, actor: str | None) -> QcUndoOut:
    """Reverse the most recent qc_commit on this cell - reopen it and restore every use and
    sample it touched, unless an item has since drifted (a sample requeued elsewhere, or a
    top-up whose request was already sent - a real-world action we won't silently undo)."""
    last = db.scalars(
        select(AuditLog)
        .where(AuditLog.entity_type == "cell", AuditLog.entity_id == cell.id, AuditLog.action == "qc_commit")
        .order_by(AuditLog.id.desc())
        .limit(1)
    ).first()
    if last is None or "uses" not in last.details_json:
        raise ValueError("No recorded Cell QC action found to undo.")

    details = last.details_json
    reverted: list[int] = []
    drifted: list[int] = []
    deleted_topups: list[int] = []
    touched_cell_ids: set[int] = set()

    use_ids = [int(k) for k in details.get("uses", {})]
    uses = {cu.id: cu for cu in db.scalars(select(CellUse).where(CellUse.id.in_(use_ids)))} if use_ids else {}
    for key, snap in details.get("uses", {}).items():
        cu = uses.get(int(key))
        if cu is None:
            continue
        prior_status = snap.get("prior_status", "planned")
        prior_cell_id = snap.get("prior_cell_id")
        # Reassigned use (still on the new cell, planned) -> move it back.
        if prior_cell_id is not None and cu.cell_id != prior_cell_id and cu.status != "cancelled":
            if cu.status != "planned":
                drifted.append(cu.id)
                continue
            touched_cell_ids.add(cu.cell_id)
            touched_cell_ids.add(prior_cell_id)
            cu.cell_id = prior_cell_id
            cu.reassigned_from_cell_id = snap.get("prior_reassigned_from")
            reverted.append(cu.id)
            continue
        # Failed trigger or displaced/cancelled use -> restore its prior status/timestamps.
        cu.status = prior_status
        started = snap.get("prior_started_at")
        cu.started_at = ensure_aware(datetime.fromisoformat(started)) if started else None
        completed = snap.get("prior_completed_at")
        cu.completed_at = ensure_aware(datetime.fromisoformat(completed)) if completed else None
        cu.outcome_notes = snap.get("prior_outcome_notes")
        cu.reassigned_from_cell_id = snap.get("prior_reassigned_from")
        reverted.append(cu.id)

    for key, snap in details.get("samples", {}).items():
        sample = db.get(Sample, int(key))
        if sample is None:
            continue
        topup_id = snap.get("topup_id")
        if topup_id is not None:
            topup = db.get(SampleTopup, topup_id)
            if topup is not None:
                if topup.request_sent_at is not None:
                    drifted.append(int(key))
                    continue  # a sent request is a real action - leave sample failed + topup intact
                db.delete(topup)
                deleted_topups.append(topup_id)
        sample.status = snap.get("prior_status", sample.status)
        sample.priority = snap.get("prior_priority")
        sample.qc_disposition = snap.get("prior_qc_disposition")

    cell.status = details.get("cell", {}).get("prior_status", "open")
    prior_stopped_at = details.get("cell", {}).get("prior_stopped_at")
    cell.stopped_at = ensure_aware(datetime.fromisoformat(prior_stopped_at)) if prior_stopped_at else None
    cell.stopped_reason = details.get("cell", {}).get("prior_stopped_reason")

    db.flush()
    recompute_status(cell, utcnow())
    for cid in touched_cell_ids:
        sib = db.get(Cell, cid)
        if sib is not None:
            db.refresh(sib, attribute_names=["cell_uses"])
            recompute_status(sib, utcnow())

    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="qc_undo",
            entity_type="cell",
            entity_id=cell.id,
            details_json={"reverted": reverted, "drifted": drifted, "deleted_topup_ids": deleted_topups},
        )
    )
    db.commit()
    db.refresh(cell)
    db.refresh(cell, attribute_names=["cell_uses"])
    return QcUndoOut(
        cell=serialize_cell(cell),
        reverted_cell_use_ids=reverted,
        drifted_cell_use_ids=drifted,
        deleted_topup_ids=deleted_topups,
    )


# --------------------------------------------------------------------------------------
# Top-up list ops
# --------------------------------------------------------------------------------------


def _topup_out(topup: SampleTopup) -> SampleTopupOut:
    sample = topup.sample
    source = _topup_source(topup)
    return SampleTopupOut(
        id=topup.id,
        sample_id=topup.sample_id,
        pool_id=sample.pool_id if sample else None,
        barcodes=sample.barcode_list if sample else [],
        priority=sample.priority if sample else None,
        created_at=topup.created_at,
        request_sent_at=topup.request_sent_at,
        note=topup.note,
        created_by=topup.created_by,
        source_run_name=source[0],
        source_cell_code=source[1],
        source_well=source[2],
    )


def _topup_source(topup: SampleTopup) -> tuple[str | None, str | None, str | None]:
    """(run_name, cell_code, well) of the acquisition the loss came from, or (None,)*3."""
    cu = topup.source_cell_use
    if cu is None:
        return (None, None, None)
    run_batch = cu.cycle.run_batch if cu.cycle else None
    return (
        run_batch.run_name if run_batch else None,
        cu.cell.code if cu.cell else None,
        cu.well,
    )


def list_topups(db: Session, only_pending: bool | None = None) -> list[SampleTopupOut]:
    stmt = select(SampleTopup)
    if only_pending is True:
        stmt = stmt.where(SampleTopup.request_sent_at.is_(None))
    elif only_pending is False:
        stmt = stmt.where(SampleTopup.request_sent_at.is_not(None))
    topups = list(db.scalars(stmt.order_by(SampleTopup.created_at.desc())))
    return [_topup_out(t) for t in topups]


def mark_topup_request_sent(db: Session, topup: SampleTopup, actor: str | None) -> SampleTopupOut:
    topup.request_sent_at = utcnow().date()
    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="topup_request_sent",
            entity_type="sample_topup",
            entity_id=topup.id,
            details_json={"sample_id": topup.sample_id, "request_sent_at": topup.request_sent_at.isoformat()},
        )
    )
    db.commit()
    db.refresh(topup)
    return _topup_out(topup)


def cancel_topup(db: Session, topup: SampleTopup, actor: str | None) -> None:
    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="topup_cancelled",
            entity_type="sample_topup",
            entity_id=topup.id,
            details_json={"sample_id": topup.sample_id},
        )
    )
    db.delete(topup)
    db.commit()
