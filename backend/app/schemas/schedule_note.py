from datetime import date, datetime

from pydantic import BaseModel


class ScheduleNoteUpdate(BaseModel):
    """Edit is a full replace of the text and the instrument set - unticking an instrument
    unpins the note from it. The day only changes by dragging the banner (ScheduleNoteMove)."""

    body: str
    instrument_ids: list[int]
    actor: str | None = None


class ScheduleNoteCreate(ScheduleNoteUpdate):
    note_date: date


class ScheduleNoteMove(BaseModel):
    """A banner dragged in the Schedule grid from its row (from_instrument_serial) onto another
    instrument/day cell. Serials, not ids: the grid keys its rows by serial."""

    note_date: date
    from_instrument_serial: str
    to_instrument_serial: str
    actor: str | None = None


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
