from datetime import datetime

from pydantic import BaseModel


class InstrumentOut(BaseModel):
    id: int
    serial_number: str
    name: str | None
    active: bool
    is_locked: bool
    locked_until: datetime | None


class InstrumentCreate(BaseModel):
    serial_number: str
    name: str | None = None
    active: bool = True


class InstrumentUpdate(BaseModel):
    name: str | None = None
    active: bool | None = None
