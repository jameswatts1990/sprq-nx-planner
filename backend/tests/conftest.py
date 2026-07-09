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
