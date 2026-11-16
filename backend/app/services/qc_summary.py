"""The QC worklist's action counts, behind GET /api/qc/summary (the QC nav item's count chip, and
later the Today page). Counts every PacBio credit case - cells' own cases plus cases logged without
a cell - so it agrees with the QC page.

The overdue rule is a Python twin of the frontend's: keep case_failure_at in step with
utils/creditCase.cellFailureAt / pages/QcPage/qcCases.qcCaseFailureMs, and is_overdue with
utils/creditCase.creditCaseAge. One known gap: a no-cell case's occurred-on day starts at UTC
midnight here and at local midnight in the browser, so near the limit the two can differ by a day
during British Summer Time."""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, datetime, time

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.cell import Cell
from app.models.credit_case import CreditCaseMixin
from app.models.pacbio_case import PacbioCase
from app.models.schedule import CellUse
from app.services import credit_service
from app.services.cell_service import credit_status_clause, use_sort_key
from app.services.settings_service import get_qc_overdue_days
from app.timeutil import ensure_aware, utcnow

_DAY_S = 86_400


@dataclass(frozen=True)
class QcSummary:
    needs_report: int
    # Reported to PacBio but not yet received in the lab (confirmed or not) - the Stats credit
    # funnel's and the Cells page's "Awaiting" definition.
    awaiting_credit: int
    overdue: int
    # Cases the lab has to act on: not yet reported, or overdue. Each case counted once.
    total_action: int


def cell_failure_at(cell: Cell) -> datetime:
    """When a cell's case "failed": its triggering use (the latest Failed use, else its latest use)
    finishing, else starting, else the cell's stop, else its creation."""
    uses = sorted(cell.cell_uses, key=use_sort_key)
    use = next((u for u in reversed(uses) if u.status == "failed"), uses[-1] if uses else None)
    use_at = (use.completed_at or use.started_at) if use else None
    at = use_at or cell.stopped_at or cell.created_at
    return ensure_aware(at)


def pacbio_case_failure_at(case: PacbioCase) -> datetime:
    return datetime.combine(case.occurred_on, time.min, tzinfo=UTC)


def is_overdue(case: CreditCaseMixin, failure_at: datetime, overdue_days: int, now: datetime) -> bool:
    """Still open (some step not yet done - a received case missing its internal report is still
    open, as on the QC page) and its current stage has waited more than overdue_days whole days
    since the latest completed step (or the failure)."""
    steps = [case.pacbio_reported_at, case.internal_report_at, case.pacbio_credit_confirmed_at]
    if case.credit_received_at is not None and all(s is not None for s in steps):
        return False
    since = max([failure_at, *(ensure_aware(s) for s in steps if s is not None)])
    return math.floor((now - since).total_seconds() / _DAY_S) > overdue_days


def compute_qc_summary(db: Session, now: datetime | None = None) -> QcSummary:
    now = now or utcnow()
    overdue_days = get_qc_overdue_days(db)
    cells = db.scalars(
        select(Cell)
        .where(credit_status_clause("in_workflow"))
        .options(selectinload(Cell.cell_uses).selectinload(CellUse.cycle))
    ).unique()
    cases: list[tuple[CreditCaseMixin, datetime]] = [(c, cell_failure_at(c)) for c in cells]
    cases += [(pc, pacbio_case_failure_at(pc)) for pc in db.scalars(select(PacbioCase))]

    needs = awaiting = overdue = action = 0
    for case, failure_at in cases:
        case_needs = credit_service.needs_report(case)
        case_overdue = is_overdue(case, failure_at, overdue_days, now)
        needs += case_needs
        awaiting += credit_service.awaiting_credit(case)
        overdue += case_overdue
        action += case_needs or case_overdue
    return QcSummary(needs_report=needs, awaiting_credit=awaiting, overdue=overdue, total_action=action)
