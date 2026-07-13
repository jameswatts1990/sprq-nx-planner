"""One-off migration of the local dev SQLite database into the deployed Postgres.

Run inside the backend container so it reaches `db:5432` over the internal Docker
network without ever publishing Postgres's port to the host:

    docker compose exec backend python scripts/migrate_sqlite_to_postgres.py /path/to/dev.db
"""

import sys

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.db import engine as dest_engine
from app.models import (
    AuditLog,
    Cell,
    CellUse,
    CellUseBarcode,
    Cycle,
    ImportBatch,
    Instrument,
    RunBatch,
    Sample,
    SampleBarcode,
)

# Parent-before-child, respecting every FK in app/models/.
MODELS_IN_ORDER = [
    Instrument,
    ImportBatch,
    Cell,
    Sample,
    SampleBarcode,
    RunBatch,
    Cycle,
    CellUse,
    CellUseBarcode,
    AuditLog,
]


def clear_table(dest_session, model) -> None:
    dest_session.query(model).delete()


def copy_table(source_session, dest_session, model) -> int:
    columns = [c.name for c in model.__table__.columns]
    rows = source_session.query(model).order_by(model.id).all()
    for row in rows:
        dest_session.add(model(**{col: getattr(row, col) for col in columns}))
    dest_session.flush()
    return len(rows)


def reset_sequence(dest_session, table_name: str) -> None:
    max_id = dest_session.execute(text(f"SELECT MAX(id) FROM {table_name}")).scalar()
    if max_id is None:
        return
    dest_session.execute(
        text("SELECT setval(pg_get_serial_sequence(:table, 'id'), :value)"),
        {"table": table_name, "value": max_id},
    )


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: migrate_sqlite_to_postgres.py /path/to/dev.db", file=sys.stderr)
        raise SystemExit(1)

    source_engine = create_engine(f"sqlite:///{sys.argv[1]}")
    SourceSession = sessionmaker(bind=source_engine)
    DestSession = sessionmaker(bind=dest_engine)

    with SourceSession() as source_session, DestSession() as dest_session:
        # instruments is pre-seeded by an Alembic migration, so the destination
        # already has rows before this script ever runs - clear everything first
        # (reverse FK order) so the migrated data is the single source of truth.
        for model in reversed(MODELS_IN_ORDER):
            clear_table(dest_session, model)
        dest_session.flush()

        for model in MODELS_IN_ORDER:
            count = copy_table(source_session, dest_session, model)
            print(f"{model.__tablename__}: copied {count} rows")

        for model in MODELS_IN_ORDER:
            reset_sequence(dest_session, model.__tablename__)

        dest_session.commit()

    print("Done.")


if __name__ == "__main__":
    main()
