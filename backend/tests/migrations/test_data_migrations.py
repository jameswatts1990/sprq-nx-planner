"""Migrations that move or transform existing rows.

test_migrations.py runs every migration on empty tables, which can't catch a wrong data copy.
Add a test here for each migration that moves data: upgrade to the revision before it, insert
rows with raw SQL (not the models, which follow the latest schema), upgrade, assert, then
downgrade and assert again. Pin both revision ids so later migrations don't affect the test.
"""

from datetime import date

from alembic import command
from sqlalchemy import inspect, text

# d5a1c7e3f9b2 moves each instrument's down_from/down_note into instrument_downtimes.
BEFORE_DOWNTIMES = "c3f8a1d6e2b9"
DOWNTIMES = "d5a1c7e3f9b2"


def test_downtime_migration_moves_down_flag_into_a_period(alembic_config, engine):
    command.upgrade(alembic_config, BEFORE_DOWNTIMES)
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE instruments SET down_from = :d, down_note = :n WHERE serial_number = '84047'"),
            {"d": date(2026, 11, 10), "n": "laser fault"},
        )

    command.upgrade(alembic_config, DOWNTIMES)
    with engine.connect() as conn:
        periods = conn.execute(
            text(
                "SELECT i.serial_number, d.start_date, d.end_date, d.kind, d.note, d.created_by "
                "FROM instrument_downtimes d JOIN instruments i ON i.id = d.instrument_id"
            )
        ).all()
    assert [tuple(p) for p in periods] == [
        ("84047", date(2026, 11, 10), None, "unplanned", "laser fault", "migration")
    ]
    columns = {c["name"] for c in inspect(engine).get_columns("instruments")}
    assert not {"down_from", "down_note"} & columns

    command.downgrade(alembic_config, BEFORE_DOWNTIMES)
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT serial_number, down_from, down_note FROM instruments ORDER BY serial_number")
        ).all()
    assert [tuple(r) for r in rows] == [
        ("84047", date(2026, 11, 10), "laser fault"),
        ("84093", None, None),
        ("84098", None, None),
        ("84309", None, None),
    ]
    assert "instrument_downtimes" not in inspect(engine).get_table_names()
