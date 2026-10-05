"""Stage rules for the PacBio credit workflow, shared by both kinds of credit case - a cell's own
case and a case logged without a cell (see models/credit_case.py). Each function validates and
stamps one stage; the caller owns its own precondition (e.g. "this cell actually failed"), audit
entry and commit, so the rules themselves can never drift between the two kinds."""
from __future__ import annotations

from app.models.credit_case import CreditCaseMixin
from app.timeutil import utcnow


def _required(value: str, what: str) -> str:
    value = (value or "").strip()
    if not value:
        raise ValueError(f"{what} is required.")
    return value


def stamp_pacbio_report(case: CreditCaseMixin, case_number: str) -> None:
    """Record the PacBio case number. Saving it again corrects the number but keeps the original
    reported-at time - a typo fix shouldn't move when the case was raised."""
    case.pacbio_case_number = _required(case_number, "A PacBio case number")
    if case.pacbio_reported_at is None:
        case.pacbio_reported_at = utcnow()


def stamp_internal_report(case: CreditCaseMixin, report_id: str) -> None:
    """Record the internal report ID. The first save stamps internal_report_at (completing the
    stage); later edits correct the ID but keep the original raised-at time."""
    case.internal_report_id = _required(report_id, "An internal report ID")
    if case.internal_report_at is None:
        case.internal_report_at = utcnow()


def stamp_credit_confirmed(case: CreditCaseMixin, acquisitions: int) -> None:
    if case.pacbio_case_number is None:
        raise ValueError("This case has not been reported to PacBio yet.")
    if acquisitions < 1:
        raise ValueError("Credited acquisitions must be a positive number.")
    case.credit_acquisitions = acquisitions
    # Re-confirming corrects the count; the confirmed-at time stays when it first happened.
    if case.pacbio_credit_confirmed_at is None:
        case.pacbio_credit_confirmed_at = utcnow()


def stamp_credit_received(case: CreditCaseMixin) -> None:
    if case.pacbio_reported_at is None:
        raise ValueError("This case has not been reported to PacBio yet.")
    case.credit_received_at = utcnow()


def set_owner(case: CreditCaseMixin, owner: str | None) -> None:
    """Editable at any stage. Blank clears it."""
    owner = (owner or "").strip() or None
    if owner is not None and len(owner) > 120:
        raise ValueError("Owner must be 120 characters or fewer.")
    case.credit_owner = owner


def set_notes(case: CreditCaseMixin, notes: str | None) -> None:
    """Editable at any stage, so not tied to any one step's timestamp. Blank clears it."""
    case.credit_notes = (notes or "").strip() or None


def needs_report(case: CreditCaseMixin) -> bool:
    """Not yet raised with PacBio. (A cell additionally has to be in the workflow at all -
    cell_service.needs_qc_report.)"""
    return case.pacbio_reported_at is None


def awaiting_credit(case: CreditCaseMixin) -> bool:
    """Reported to PacBio, but the credit hasn't physically landed in the lab yet."""
    return case.pacbio_reported_at is not None and case.credit_received_at is None
