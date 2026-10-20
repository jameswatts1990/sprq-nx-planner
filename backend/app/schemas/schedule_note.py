from datetime import date, datetime

from pydantic import BaseModel


class ScheduleNoteUpdate(BaseModel):
    """Edit is a full replace of the text and the instrument set - unticking an instrument
    unpins the note from it; the day itself is fixed once created."""

    body: str
    instrument_ids: list[int]
    actor: str | None = None


class ScheduleNoteCreate(ScheduleNoteUpdate):
    note_date: date


class ScheduleNoteOut(BaseModel):
    id: int
    note_date: date
    body: str
    instrument_ids: list[int]
    # Serials alongside ids: the Schedule grid keys its rows by serial.
    instrument_serials: list[str]
    created_by: str | None
    created_at: datetime
    updated_at: datetime
