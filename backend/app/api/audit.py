from datetime import date

from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import SessionDep
from app.models.audit import AuditLog
from app.schemas.audit import AuditLogOut
from app.schemas.common import Page

router = APIRouter(prefix="/api/audit-log", tags=["audit"])


@router.get("", response_model=Page[AuditLogOut])
def list_audit_log(
    db: SessionDep,
    entity_type: str | None = None,
    entity_id: int | None = None,
    actor: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = 1,
    page_size: int = 50,
) -> Page[AuditLogOut]:
    stmt = select(AuditLog).order_by(AuditLog.at.desc())
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if entity_id is not None:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    if actor:
        stmt = stmt.where(AuditLog.actor == actor)
    if date_from:
        stmt = stmt.where(AuditLog.at >= date_from)
    if date_to:
        stmt = stmt.where(AuditLog.at <= date_to)

    all_rows = list(db.scalars(stmt).all())
    total = len(all_rows)
    start = (page - 1) * page_size
    page_rows = all_rows[start : start + page_size]
    return Page[AuditLogOut](items=[_audit_log_out(r) for r in page_rows], total=total)


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
