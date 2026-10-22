from fastapi import APIRouter, HTTPException, Response
from sqlalchemy.orm import selectinload

from app.api.deps import ActorDep, SessionDep
from app.models.schedule import CellUse, Cycle, RunBatch
from app.models.topup import SampleTopup
from app.schemas.topup import SampleTopupOut
from app.services.qc_service import cancel_topup, list_topups, mark_topup_request_sent

router = APIRouter(prefix="/api/topups", tags=["topups"])


def _get_topup(db: SessionDep, topup_id: int) -> SampleTopup:
    topup = db.get(
        SampleTopup,
        topup_id,
        options=[
            selectinload(SampleTopup.sample),
            selectinload(SampleTopup.source_cell_use).selectinload(CellUse.cell),
            selectinload(SampleTopup.source_cell_use).selectinload(CellUse.cycle).selectinload(Cycle.run_batch),
        ],
    )
    if topup is None:
        raise HTTPException(404, "Resupply request not found")
    return topup


@router.get("", response_model=list[SampleTopupOut])
def list_topups_endpoint(
    db: SessionDep, status: str | None = None, sample_id: int | None = None
) -> list[SampleTopupOut]:
    """Resupply requests (internally "top-ups": table/API/audit names keep that spelling).
    The Backlog's "Resupply requests" list asks for status=pending (not yet sent); a sample's
    detail page asks for all of its own (sample_id), which is where sent requests stay visible."""
    only_pending: bool | None = None
    if status == "pending":
        only_pending = True
    elif status == "sent":
        only_pending = False
    elif status is not None:
        raise HTTPException(400, "status must be 'pending' or 'sent'")
    return list_topups(db, only_pending=only_pending, sample_id=sample_id)


@router.post("/{topup_id}/request-sent", response_model=SampleTopupOut)
def request_sent_endpoint(topup_id: int, db: SessionDep, actor: ActorDep) -> SampleTopupOut:
    """Confirm the resupply request went out - stamps today's date on the entry."""
    topup = _get_topup(db, topup_id)
    return mark_topup_request_sent(db, topup, actor)


@router.delete("/{topup_id}", status_code=204)
def cancel_topup_endpoint(topup_id: int, db: SessionDep, actor: ActorDep) -> Response:
    """Cancel (delete) a resupply request. The sample itself is untouched."""
    topup = _get_topup(db, topup_id)
    cancel_topup(db, topup, actor)
    return Response(status_code=204)
