from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import String, cast, func, or_, select

from app.api.deps import SessionDep, pagination
from app.models.audit import AuditLog
from app.schemas.audit import AuditLogOut
from app.schemas.common import Page

router = APIRouter(prefix="/api/audit-log", tags=["audit"])


def _utc_midnight(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=UTC)


@router.get("", response_model=Page[AuditLogOut])
def list_audit_log(
    db: SessionDep,
    page_info: Annotated[tuple[int, int], Depends(pagination)],
    entity_type: str | None = None,
    entity_id: int | None = None,
    actor: str | None = None,
    action: str | None = None,
    q: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> Page[AuditLogOut]:
    """The audit trail, newest first, filtered and paged in SQL. `action` takes one action or a
    comma-separated set (an "action group"); `q` matches actor, action, entity type/id or any text
    in the details. Both date bounds are inclusive UTC days."""
    page, page_size = page_info
    stmt = select(AuditLog)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if entity_id is not None:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    if actor:
        stmt = stmt.where(AuditLog.actor == actor)
    actions = [a.strip() for a in (action or "").split(",") if a.strip()]
    if actions:
        stmt = stmt.where(AuditLog.action.in_(actions))
    term = (q or "").strip()
    if term:
        like = f"%{term}%"
        stmt = stmt.where(
            or_(
                AuditLog.actor.ilike(like),
                AuditLog.action.ilike(like),
                AuditLog.entity_type.ilike(like),
                cast(AuditLog.entity_id, String).ilike(like),
                cast(AuditLog.details_json, String).ilike(like),
            )
        )
    if date_from:
        stmt = stmt.where(AuditLog.at >= _utc_midnight(date_from))
    if date_to:
        # `at` is a timestamp: everything before the next day's midnight, so date_to's own day counts.
        stmt = stmt.where(AuditLog.at < _utc_midnight(date_to + timedelta(days=1)))

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(AuditLog.at.desc(), AuditLog.id.desc()).limit(page_size).offset((page - 1) * page_size)
    )
    return Page[AuditLogOut](items=[_audit_log_out(r) for r in rows], total=total)


def _audit_log_out(row: AuditLog) -> AuditLogOut:
    return AuditLogOut(
        id=row.id,
        at=row.at,
        actor=row.actor,
        action=row.action,
        entity_type=row.entity_type,
        entity_id=row.entity_id,
        details_json=row.details_json or {},
    )
