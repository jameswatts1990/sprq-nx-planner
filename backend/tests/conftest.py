from pathlib import Path

import pytest

from app.engine.normalize import normalize_samples

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def example_samples_text() -> str:
    return (FIXTURES_DIR / "example_samples.csv").read_text()


@pytest.fixture
def example_samples(example_samples_text):
    return normalize_samples(example_samples_text).samples


@pytest.fixture(autouse=True)
def _fresh_mlwh_cache():
    """MLWH reads are cached per process (services/mlwh_wells.fetch) - never across tests."""
    from app.services import mlwh_wells

    mlwh_wells.reset()
    yield
    mlwh_wells.reset()


@pytest.fixture
def fake_mlwh(monkeypatch):
    """MLWH configured, and answered by an SQLite copy of its tables (tests/mlwh_fake.py)."""
    from app.services import mlwh, mlwh_wells
    from tests.mlwh_fake import FakeMlwh

    fake = FakeMlwh()
    monkeypatch.setattr(mlwh, "is_configured", lambda: True)
    monkeypatch.setattr(mlwh_wells, "engine", lambda: fake.engine)
    yield fake
    fake.engine.dispose()
