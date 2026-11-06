from datetime import datetime
from typing import Literal

from pydantic import BaseModel

AuditLinkKind = Literal["run", "sample", "cell", "tray", "instrument"]


class AuditLinkOut(BaseModel):
    """Something an audit row is about that still exists, so the Activity page can link to it."""

    kind: AuditLinkKind
    id: int
    label: str


class AuditLogOut(BaseModel):
    id: int
    at: datetime
    actor: str
    action: str
    entity_type: str
    entity_id: int | None
    details_json: dict
    # The run / sample / cell / tray / instrument this row touched, resolved at read time.
    links: list[AuditLinkOut] = []
