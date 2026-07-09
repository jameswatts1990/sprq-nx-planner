from fastapi import APIRouter, HTTPException

from app.api.deps import ActorDep, SessionDep
from app.schemas.schedule import CommitRequest, PreviewRequest, PreviewResponse, ScheduleOut
from app.services.commit_service import BacklogChangedError, UnknownInstrumentError, commit_schedule
from app.services.preview_service import build_preview
from app.services.schedule_service import serialize_schedule

router = APIRouter(prefix="/api/schedule", tags=["schedule"])


@router.post("/preview", response_model=PreviewResponse)
def preview_schedule(req: PreviewRequest, db: SessionDep) -> PreviewResponse:
    return build_preview(db, req)


@router.post("/commit", response_model=ScheduleOut, status_code=201)
def commit_schedule_endpoint(req: CommitRequest, db: SessionDep, actor: ActorDep) -> ScheduleOut:
    req = req.model_copy(update={"actor": req.actor or actor})
    try:
        schedule = commit_schedule(db, req)
    except BacklogChangedError as exc:
        raise HTTPException(409, str(exc)) from exc
    except UnknownInstrumentError as exc:
        raise HTTPException(400, str(exc)) from exc
    return serialize_schedule(schedule)
