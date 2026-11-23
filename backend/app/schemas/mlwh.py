from pydantic import BaseModel


class MlwhTable(BaseModel):
    name: str
    approx_rows: int | None  # InnoDB's cached estimate (NULL for views), not an exact COUNT(*)


class MlwhStatus(BaseModel):
    configured: bool  # False: MLWH_DATABASE_URL is unset - a normal state, not an error
    ok: bool
    target: str | None = None  # user@host:port/database - never includes the password
    elapsed_ms: int | None = None  # connect + both queries
    server_version: str | None = None
    tables: list[MlwhTable] = []
    error: str | None = None
