"""PacBio credit cases logged without a RunNx cell (models/pacbio_case.py): create / edit /
delete their hand-entered details, and step them through the same credit stages as a cell's
case via credit_service. Nothing here touches cells, uses, samples or the schedule."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.audit import AuditLog
from app.models.instrument import Instrument
from app.models.pacbio_case import PacbioCase
from app.schemas.pacbio_case import PacbioCaseCreate, PacbioCaseDetailsIn, PacbioCaseOut
from app.services import credit_service

ENTITY_TYPE = "pacbio_case"

# The editable details, in form order - drives the edit audit diff and the delete snapshot.
_DETAIL_FIELDS = ("summary", "occurred_on", "instrument_id", "run_name", "pool_id", "expected_acquisitions")


def serialize_case(case: PacbioCase) -> PacbioCaseOut:
    return PacbioCaseOut(
        id=case.id,
        summary=case.summary,
        occurred_on=case.occurred_on,
        instrument_id=case.instrument_id,
        instrument_serial=case.instrument.serial_number if case.instrument else None,
        run_name=case.run_name,
        pool_id=case.pool_id,
        expected_acquisitions=case.expected_acquisitions,
        created_by=case.created_by,
        created_at=case.created_at,
        internal_report_id=case.internal_report_id,
        internal_report_at=case.internal_report_at,
        pacbio_case_number=case.pacbio_case_number,
        pacbio_reported_at=case.pacbio_reported_at,
        pacbio_credit_confirmed_at=case.pacbio_credit_confirmed_at,
        credit_acquisitions=case.credit_acquisitions,
        credit_notes=case.credit_notes,
        credit_received_at=case.credit_received_at,
    )


def list_cases(db: Session) -> list[PacbioCaseOut]:
    stmt = select(PacbioCase).options(selectinload(PacbioCase.instrument)).order_by(
        PacbioCase.occurred_on.desc(), PacbioCase.id.desc()
    )
    return [serialize_case(c) for c in db.scalars(stmt)]


def _text(value: str | None, max_len: int, label: str) -> str | None:
    value = (value or "").strip() or None
    if value is not None and len(value) > max_len:
        raise ValueError(f"{label} must be {max_len} characters or fewer.")
    return value


def _apply_details(db: Session, case: PacbioCase, req: PacbioCaseDetailsIn) -> None:
    summary = _text(req.summary, 200, "Summary")
    if summary is None:
        raise ValueError("Describe what happened - a summary is required.")
    if req.instrument_id is not None and db.get(Instrument, req.instrument_id) is None:
        raise ValueError("That instrument no longer exists.")
    if req.expected_acquisitions is not None and req.expected_acquisitions < 1:
        raise ValueError("Expected acquisitions must be a positive number.")
    case.summary = summary
    case.occurred_on = req.occurred_on
    case.instrument_id = req.instrument_id
    case.run_name = _text(req.run_name, 120, "Run")
    case.pool_id = _text(req.pool_id, 120, "Pool ID")
    case.expected_acquisitions = req.expected_acquisitions


def _snapshot(case: PacbioCase) -> dict:
    out = {f: getattr(case, f) for f in _DETAIL_FIELDS}
    out["occurred_on"] = case.occurred_on.isoformat() if case.occurred_on else None
    return out


def _commit(db: Session, case: PacbioCase, action: str, details: dict, actor: str | None) -> PacbioCaseOut:
    db.add(
        AuditLog(actor=actor or "unknown", action=action, entity_type=ENTITY_TYPE, entity_id=case.id, details_json=details)
    )
    db.commit()
    db.refresh(case)
    return serialize_case(case)


def create_case(db: Session, req: PacbioCaseCreate, actor: str | None) -> PacbioCaseOut:
    case = PacbioCase(created_by=actor or "unknown")
    _apply_details(db, case, req)
    if (req.pacbio_case_number or "").strip():
        credit_service.stamp_pacbio_report(case, req.pacbio_case_number)
    credit_service.set_notes(case, req.credit_notes)
    db.add(case)
    db.flush()
    details = _snapshot(case) | {"pacbio_case_number": case.pacbio_case_number, "notes": case.credit_notes}
    return _commit(db, case, "create_pacbio_case", details, actor)


def update_case(db: Session, case: PacbioCase, req: PacbioCaseDetailsIn, actor: str | None) -> PacbioCaseOut:
    before = _snapshot(case)
    _apply_details(db, case, req)
    after = _snapshot(case)
    changed = {k: {"from": before[k], "to": after[k]} for k in _DETAIL_FIELDS if before[k] != after[k]}
    return _commit(db, case, "update_pacbio_case", changed, actor)


def delete_case(db: Session, case: PacbioCase, actor: str | None) -> None:
    """Hard delete (a case logged by mistake). The audit entry keeps the full record, since -
    unlike a cell's case, which Undo QC unwinds - nothing else holds it."""
    out = serialize_case(case)
    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="delete_pacbio_case",
            entity_type=ENTITY_TYPE,
            entity_id=case.id,
            details_json=out.model_dump(mode="json"),
        )
    )
    db.delete(case)
    db.commit()


def set_internal_report(db: Session, case: PacbioCase, report_id: str, actor: str | None) -> PacbioCaseOut:
    credit_service.stamp_internal_report(case, report_id)
    return _commit(db, case, "set_case_internal_report", {"report_id": case.internal_report_id}, actor)


def report_to_pacbio(db: Session, case: PacbioCase, case_number: str, actor: str | None) -> PacbioCaseOut:
    credit_service.stamp_pacbio_report(case, case_number)
    return _commit(db, case, "report_case_to_pacbio", {"case_number": case.pacbio_case_number}, actor)


def set_notes(db: Session, case: PacbioCase, notes: str | None, actor: str | None) -> PacbioCaseOut:
    credit_service.set_notes(case, notes)
    return _commit(db, case, "set_case_credit_notes", {"notes": case.credit_notes}, actor)


def confirm_credit(db: Session, case: PacbioCase, acquisitions: int, actor: str | None) -> PacbioCaseOut:
    credit_service.stamp_credit_confirmed(case, acquisitions)
    return _commit(db, case, "confirm_case_credit", {"acquisitions": acquisitions}, actor)


def receive_credit(db: Session, case: PacbioCase, actor: str | None) -> PacbioCaseOut:
    credit_service.stamp_credit_received(case)
    return _commit(db, case, "receive_case_credit", {}, actor)
