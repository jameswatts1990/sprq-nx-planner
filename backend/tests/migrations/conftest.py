"""Fixtures for running Alembic migrations against a real Postgres.

CI and the devcontainer set MIGRATION_TEST_DATABASE_URL to a throwaway Postgres; without it
every test here is skipped. Each test starts from an empty `public` schema, so never point the variable at a
database you want to keep.
"""

import os
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text

from app.config import settings

DATABASE_URL = os.environ.get("MIGRATION_TEST_DATABASE_URL")
BACKEND_DIR = Path(__file__).resolve().parents[2]


@pytest.fixture
def engine(monkeypatch):
    if not DATABASE_URL:
        pytest.skip("MIGRATION_TEST_DATABASE_URL not set")
    # alembic/env.py takes its URL from app.config.settings, so point that at the test database.
    monkeypatch.setattr(settings, "database_url", DATABASE_URL)
    engine = create_engine(DATABASE_URL)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    yield engine
    engine.dispose()


@pytest.fixture
def alembic_config(engine):
    # No ini file: env.py would otherwise run logging.fileConfig and disable pytest's loggers.
    config = Config()
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    config.set_main_option("path_separator", "os")
    return config
