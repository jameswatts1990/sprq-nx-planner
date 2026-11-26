"""Every Alembic migration, schema only.

The rest of the suite builds its schema with `Base.metadata.create_all` on SQLite, so these are
the only tests that run the migrations themselves. They run on empty tables, so they don't
check what a migration does to existing rows: see test_data_migrations.py for that.
"""

import re
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect

# Only the set: importing a test function would make pytest collect it twice.
from .test_data_migrations import COVERED

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "alembic"

# A heuristic for "this migration touches rows": a migration that runs only DDL through
# op.execute is flagged too. Accepted cost - exempt it below with a reason.
DATA_OPERATIONS = re.compile(r"op\.execute|bulk_insert|get_bind\(\)")

# Migrations that touch rows but have no test in test_data_migrations.py (not in its COVERED),
# each with the reason.
# Don't add a new data migration here: write its data test instead.
DATA_TEST_EXEMPT = {
    "c4ce50a58b19": "seeds fixed rows into an empty table; the stairway runs it both ways",
    "a4f8c2e6b9d3": "shipped before data-migration tests existed",
    "d5b9f2a3c8e1": "shipped before data-migration tests existed",
    "f3b9c1a7e2d5": "shipped before data-migration tests existed",
}


def _revisions_oldest_first(config: Config) -> list[str]:
    script = ScriptDirectory.from_config(config)
    return [rev.revision for rev in reversed(list(script.walk_revisions("base", "heads")))]


def test_every_data_migration_has_a_data_test():
    """Needs no database, so it also runs locally."""
    missing = [
        f"{rev.revision} ({Path(rev.path).name})"
        for rev in ScriptDirectory(str(MIGRATIONS_DIR)).walk_revisions()
        if DATA_OPERATIONS.search(Path(rev.path).read_text(encoding="utf-8"))
        and rev.revision not in COVERED
        and rev.revision not in DATA_TEST_EXEMPT
    ]
    assert not missing, (
        "These migrations change existing rows but have no test in test_data_migrations.py: "
        f"{', '.join(missing)}. Add one and list the id in its COVERED (see that file's docstring),"
        " or, if the migration only runs DDL through op.execute, add it to DATA_TEST_EXEMPT with the reason."
    )


def test_single_head(alembic_config):
    assert len(ScriptDirectory.from_config(alembic_config).get_heads()) == 1


def test_upgrade_head_matches_models(alembic_config):
    command.upgrade(alembic_config, "head")
    # Fails with the list of differences when a model and the migrations disagree.
    command.check(alembic_config)


def test_every_migration_downgrades_and_upgrades_again(alembic_config, engine):
    """Stairway: upgrade one revision, downgrade it, upgrade it again, for every revision.
    Catches downgrades that fail or leave objects behind that the next upgrade trips over."""
    previous = "base"
    for revision in _revisions_oldest_first(alembic_config):
        command.upgrade(alembic_config, revision)
        command.downgrade(alembic_config, previous)
        command.upgrade(alembic_config, revision)
        previous = revision

    command.downgrade(alembic_config, "base")
    assert set(inspect(engine).get_table_names()) <= {"alembic_version"}
