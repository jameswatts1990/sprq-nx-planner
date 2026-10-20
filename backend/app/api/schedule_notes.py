from datetime import date

from fastapi import APIRouter, HTTPException, Response
from sqlalchemy.orm import selectinload

from app.api.deps import ActorDep, SessionDep
from app.models.schedule_note import ScheduleNote
from app.schemas.schedule_note import (
    ScheduleNoteCreate,
    ScheduleNoteOut,
    ScheduleNoteUpdate,
)
from app.services import schedule_note_service as svc

# Day notes pinned to instruments, shown as banners in the Schedule grid.
router = APIRouter(prefix="/api/schedule-notes", tags=["schedule-notes"])


def _get_note(db: SessionDep, note_id: int) -> ScheduleNote:
    note = db.get(ScheduleNote, note_id, options=[selectinload(ScheduleNote.instruments)])
    if note is None:
        raise HTTPException(404, "Note not found")
    return note


@router.get("", response_model=list[ScheduleNoteOut])
def list_notes(db: SessionDep, date_from: date | None = None, date_to: date | None = None) -> list[ScheduleNoteOut]:
    return svc.list_notes(db, date_from, date_to)


@router.post("", response_model=ScheduleNoteOut, status_code=201)
def create_note(req: ScheduleNoteCreate, db: SessionDep, actor: ActorDep) -> ScheduleNoteOut:
    try:
        return svc.create_note(db, req, req.actor or actor)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.put("/{note_id}", response_model=ScheduleNoteOut)
def update_note(note_id: int, req: ScheduleNoteUpdate, db: SessionDep, actor: ActorDep) -> ScheduleNoteOut:
    note = _get_note(db, note_id)
    try:
        return svc.update_note(db, note, req, req.actor or actor)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.delete("/{note_id}", status_code=204)
def delete_note(note_id: int, db: SessionDep, actor: ActorDep) -> Response:
    svc.delete_note(db, _get_note(db, note_id), actor)
    return Response(status_code=204)
