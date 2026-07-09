from datetime import date

from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import ActorDep, SessionDep
from app.models.schedule import Cycle, RunBatch, Schedule
from app.schemas.common import Page
from app.schemas.schedule import ScheduleDetailOut, ScheduleOut
from app.services.commit_service import cancel_schedule
from app.services.schedule_service import serialize_schedule, serialize_schedule_detail

router = APIRouter(prefix="/api/schedules", tags=["schedules"])

_DETAIL_OPTIONS = [
    selectinload(Schedule.run_batches).selectinload(RunBatch.instrument),
    selectinload(Schedule.run_batches).selectinload(RunBatch.cycles).selectinload(Cycle.cell_uses),
]


def _is_bootstrap(schedule: Schedule) -> bool:
    return isinstance(schedule.settings_json, dict) and bool(schedule.settings_json.get("bootstrap"))


@router.get("", response_model=Page[ScheduleOut])
def list_schedules(
    db: SessionDep,
    status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = 1,
    page_size: int = 50,
) -> Page[ScheduleOut]:
    stmt = select(Schedule).order_by(Schedule.created_at.desc())
    if status:
        stmt = stmt.where(Schedule.status == status)
    if date_from:
        stmt = stmt.where(Schedule.start_date >= date_from)
    if date_to:
        stmt = stmt.where(Schedule.start_date <= date_to)

    all_schedules = [s for s in db.scalars(stmt).all() if not _is_bootstrap(s)]
    total = len(all_schedules)
    start = (page - 1) * page_size
    page_items = all_schedules[start : start + page_size]
    return Page[ScheduleOut](items=[serialize_schedule(s) for s in page_items], total=total)


@router.get("/{schedule_id}", response_model=ScheduleDetailOut)
def get_schedule(schedule_id: int, db: SessionDep) -> ScheduleDetailOut:
    schedule = db.get(Schedule, schedule_id, options=_DETAIL_OPTIONS)
    if schedule is None:
        raise HTTPException(404, "Schedule not found")
    return serialize_schedule_detail(schedule)


@router.post("/{schedule_id}/cancel", response_model=ScheduleOut)
def cancel_schedule_endpoint(schedule_id: int, db: SessionDep, actor: ActorDep) -> ScheduleOut:
    schedule = db.get(Schedule, schedule_id, options=_DETAIL_OPTIONS)
    if schedule is None:
        raise HTTPException(404, "Schedule not found")
    try:
        schedule = cancel_schedule(db, schedule, actor)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return serialize_schedule(schedule)
