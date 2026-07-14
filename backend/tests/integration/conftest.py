import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401  ensures every model is registered on Base.metadata
from app.db import Base, enable_sqlite_foreign_keys, get_db
from app.main import app


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    # This is its own Engine, distinct from app.db.engine - needs its own FK pragma so
    # tests actually exercise the same ON DELETE CASCADE / RESTRICT behavior production
    # (Postgres, which enforces this by default) does.
    enable_sqlite_foreign_keys(engine)
    Base.metadata.create_all(engine)
    session_local = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    session = session_local()
    # seed the four instruments, mirroring the Alembic seed migration
    from app.models.instrument import Instrument

    for serial in ["84047", "84098", "84093", "84309"]:
        session.add(Instrument(serial_number=serial, active=True))
    session.commit()

    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db_session):
    def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
