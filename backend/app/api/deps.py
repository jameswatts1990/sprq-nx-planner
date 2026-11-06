from typing import Annotated
from urllib.parse import unquote

from fastapi import Depends, Header, Query
from sqlalchemy.orm import Session

from app.db import get_db

SessionDep = Annotated[Session, Depends(get_db)]


def get_actor(
    actor: Annotated[str | None, Query(description="Free-text actor name; no auth in v1.")] = None,
    x_runnx_actor: Annotated[
        str | None,
        Header(description="The operator name set in the navbar, URI-encoded so any name survives HTTP."),
    ] = None,
) -> str:
    """Who made a change, for the audit trail. Endpoints with an `actor` body field use it first
    (`req.actor or actor`), so the full precedence is body > query > X-RunNx-Actor header >
    "unknown". The header is how the browser names every write without each call site passing it."""
    if actor:
        return actor
    header = unquote(x_runnx_actor or "").strip()[:120]
    return header or "unknown"


ActorDep = Annotated[str, Depends(get_actor)]


def pagination(
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
) -> tuple[int, int]:
    return page, page_size
