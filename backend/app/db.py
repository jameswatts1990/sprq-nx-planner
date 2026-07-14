from collections.abc import Generator

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    pass


def enable_sqlite_foreign_keys(sqlite_engine: Engine) -> None:
    """SQLite does not enforce foreign keys (or their ON DELETE CASCADE clauses) unless
    told to per-connection - without this, deleting a row through anything that bypasses
    the ORM relationship's cascade (e.g. the admin table-clear tool's raw `DELETE FROM
    cycles`) silently leaves dependent cell_uses/cell_use_barcodes rows behind instead of
    cascading, unlike Postgres (used in production) which enforces this by default.
    Confirmed to cause real bugs: orphaned cell_uses left after clearing `cycles` can
    collide with a later cycle that reuses a lower row id (SQLite reissues ids from the
    current max after a full-table delete), producing a bogus "slot already occupied"
    conflict for an unrelated brand-new placement.

    Every SQLite engine needs this call, including test engines built with their own
    create_engine() rather than the module-level `engine` below - registering the event
    listener on one Engine instance does not affect any other."""

    @event.listens_for(sqlite_engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


is_sqlite = settings.database_url.startswith("sqlite")
connect_args = {"check_same_thread": False} if is_sqlite else {}
engine = create_engine(settings.database_url, connect_args=connect_args)

if is_sqlite:
    enable_sqlite_foreign_keys(engine)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
