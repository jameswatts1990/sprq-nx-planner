from datetime import datetime

from pydantic import BaseModel


class AuditLogOut(BaseModel):
    id: int
    at: datetime
    actor: str
    action: str
    entity_type: str
    entity_id: int | None
    details_json: dict
