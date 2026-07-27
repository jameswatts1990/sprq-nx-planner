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
        raise HTTPException(404, "Top-up not found")
    return topup


@router.get("", response_model=list[SampleTopupOut])
def list_topups_endpoint(db: SessionDep, status: str | None = None) -> list[SampleTopupOut]:
    """The Backlog's "Top-up required" list. status=pending (not yet requested) / sent."""
    only_pending: bool | None = None
    if status == "pending":
        only_pending = True
    elif status == "sent":
        only_pending = False
    elif status is not None:
        raise HTTPException(400, "status must be 'pending' or 'sent'")
    return list_topups(db, only_pending=only_pending)


@router.post("/{topup_id}/request-sent", response_model=SampleTopupOut)
def request_sent_endpoint(topup_id: int, db: SessionDep, actor: ActorDep) -> SampleTopupOut:
    """Confirm the top-up request went out - stamps today's date on the entry."""
    topup = _get_topup(db, topup_id)
    return mark_topup_request_sent(db, topup, actor)


@router.delete("/{topup_id}", status_code=204)
def cancel_topup_endpoint(topup_id: int, db: SessionDep, actor: ActorDep) -> Response:
    """Cancel (delete) a top-up requirement. The sample itself is untouched."""
    topup = _get_topup(db, topup_id)
    cancel_topup(db, topup, actor)
    return Response(status_code=204)
