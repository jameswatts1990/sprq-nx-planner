"""Day notes pinned to instruments in the Schedule grid (models/schedule_note.py): list a date
range, create, edit (text + which instruments), move (a grid drag), delete. Audit-logged like
other domain actions; nothing here touches runs, cells or samples."""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.audit import AuditLog
from app.models.instrument import Instrument
from app.models.schedule_note import ScheduleNote
from app.schemas.schedule_note import (
    ScheduleNoteCreate,
    ScheduleNoteMove,
    ScheduleNoteOut,
    ScheduleNoteUpdate,
)

ENTITY_TYPE = "schedule_note"
# Long enough for a real instruction, short enough to stay a banner rather than a document.
MAX_BODY_LEN = 500


def serialize_note(note: ScheduleNote) -> ScheduleNoteOut:
    return ScheduleNoteOut(
        id=note.id,
        note_date=note.note_date,
        body=note.body,
        instrument_ids=[i.id for i in note.instruments],
        instrument_serials=[i.serial_number for i in note.instruments],
        created_by=note.created_by,
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


def list_notes(db: Session, date_from: date | None, date_to: date | None) -> list[ScheduleNoteOut]:
    stmt = select(ScheduleNote).options(selectinload(ScheduleNote.instruments))
    if date_from:
        stmt = stmt.where(ScheduleNote.note_date >= date_from)
    if date_to:
        stmt = stmt.where(ScheduleNote.note_date <= date_to)
    # Oldest first, so a cell's stacked banners keep a stable order as notes are added.
    stmt = stmt.order_by(ScheduleNote.note_date, ScheduleNote.id)
    return [serialize_note(n) for n in db.scalars(stmt)]


def _apply(db: Session, note: ScheduleNote, req: ScheduleNoteUpdate) -> None:
    body = req.body.strip()
    if not body:
        raise ValueError("Write the note first - it can't be blank.")
    if len(body) > MAX_BODY_LEN:
        raise ValueError(f"Keep the note to {MAX_BODY_LEN} characters or fewer.")
    ids = set(req.instrument_ids)
    if not ids:
        raise ValueError("Pick at least one instrument for the note.")
    instruments = list(db.scalars(select(Instrument).where(Instrument.id.in_(ids))))
    if len(instruments) != len(ids):
        raise ValueError("One of those instruments no longer exists - reload and try again.")
    note.body = body
    note.instruments = instruments


def _snapshot(note: ScheduleNote) -> dict:
    # Sorted: a freshly-assigned instrument list isn't in the relationship's serial order until
    # refresh, and an unsorted "after" would log a spurious instruments change.
    return {
        "note_date": note.note_date.isoformat(),
        "body": note.body,
        "instruments": sorted(i.serial_number for i in note.instruments),
    }


def _diff(before: dict, after: dict) -> dict:
    return {k: {"from": before[k], "to": after[k]} for k in before if before[k] != after[k]}


def _commit(db: Session, note: ScheduleNote, action: str, details: dict, actor: str | None) -> ScheduleNoteOut:
    db.add(
        AuditLog(actor=actor or "unknown", action=action, entity_type=ENTITY_TYPE, entity_id=note.id, details_json=details)
    )
    db.commit()
    db.refresh(note)
    return serialize_note(note)


def create_note(db: Session, req: ScheduleNoteCreate, actor: str | None) -> ScheduleNoteOut:
    note = ScheduleNote(note_date=req.note_date, created_by=actor or "unknown")
    _apply(db, note, req)
    db.add(note)
    db.flush()
    return _commit(db, note, "create_schedule_note", _snapshot(note), actor)


def update_note(db: Session, note: ScheduleNote, req: ScheduleNoteUpdate, actor: str | None) -> ScheduleNoteOut:
    before = _snapshot(note)
    _apply(db, note, req)
    return _commit(db, note, "update_schedule_note", _diff(before, _snapshot(note)), actor)


def move_note(db: Session, note: ScheduleNote, req: ScheduleNoteMove, actor: str | None) -> ScheduleNoteOut:
    """A banner dragged to another instrument/day cell. The whole note takes the new day (it's
    one note, so every instrument it's on moves with it) and the target instrument takes the
    dragged row's place in its set - a merge if the note is already on the target. Applied to
    the live instrument set, so a concurrent edit to the text or other instruments survives."""
    target = db.scalar(select(Instrument).where(Instrument.serial_number == req.to_instrument_serial))
    if target is None:
        raise ValueError("That instrument no longer exists - reload and try again.")
    before = _snapshot(note)
    instruments = [i for i in note.instruments if i.serial_number != req.from_instrument_serial]
    if target not in instruments:
        instruments.append(target)
    note.instruments = instruments
    note.note_date = req.note_date
    return _commit(db, note, "move_schedule_note", _diff(before, _snapshot(note)), actor)


def delete_note(db: Session, note: ScheduleNote, actor: str | None) -> None:
    """Hard delete - the audit entry keeps the full note, since nothing else holds it."""
    db.add(
        AuditLog(
            actor=actor or "unknown",
            action="delete_schedule_note",
            entity_type=ENTITY_TYPE,
            entity_id=note.id,
            details_json=_snapshot(note),
        )
    )
    db.delete(note)
    db.commit()
