from typing import Annotated

from fastapi import Depends, Query
from sqlalchemy.orm import Session

from app.db import get_db

SessionDep = Annotated[Session, Depends(get_db)]


def get_actor(actor: Annotated[str | None, Query(description="Free-text actor name; no auth in v1.")] = None) -> str:
    return actor or "unknown"


ActorDep = Annotated[str, Depends(get_actor)]


def pagination(
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
) -> tuple[int, int]:
    return page, page_size
