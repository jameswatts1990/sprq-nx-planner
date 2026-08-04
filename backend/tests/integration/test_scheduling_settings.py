"""The admin-configurable scheduling settings (currently the insert-size reuse threshold):
the settings_service get/set/validate helpers and the /api/settings/scheduling endpoints."""
import pytest

from app.engine.constants import DEFAULT_INSERT_SIZE_REUSE_THRESHOLD_BP
from app.services.settings_service import (
    get_insert_size_reuse_threshold,
    get_scheduling_settings,
    set_scheduling_settings,
)


def test_scheduling_threshold_defaults_to_the_builtin(db_session):
    assert get_insert_size_reuse_threshold(db_session) == DEFAULT_INSERT_SIZE_REUSE_THRESHOLD_BP


def test_set_and_get_scheduling_threshold(db_session):
    set_scheduling_settings(db_session, {"insert_size_reuse_threshold_bp": "4000"})
    assert get_insert_size_reuse_threshold(db_session) == 4000
    assert get_scheduling_settings(db_session)["insert_size_reuse_threshold_bp"] == "4000"


def test_set_scheduling_rejects_non_positive_and_non_numeric_and_unknown(db_session):
    with pytest.raises(ValueError):
        set_scheduling_settings(db_session, {"insert_size_reuse_threshold_bp": "0"})
    with pytest.raises(ValueError):
        set_scheduling_settings(db_session, {"insert_size_reuse_threshold_bp": "abc"})
    with pytest.raises(ValueError):
        set_scheduling_settings(db_session, {"unknown_key": "1"})


def test_scheduling_settings_api_round_trip(client):
    r = client.get("/api/settings/scheduling")
    assert r.status_code == 200
    assert r.json()["insert_size_reuse_threshold_bp"] == DEFAULT_INSERT_SIZE_REUSE_THRESHOLD_BP

    r = client.put("/api/settings/scheduling", json={"insert_size_reuse_threshold_bp": 3500})
    assert r.status_code == 200
    assert r.json()["insert_size_reuse_threshold_bp"] == 3500
    assert client.get("/api/settings/scheduling").json()["insert_size_reuse_threshold_bp"] == 3500

    # A non-positive value is a 422, not a silent store.
    assert client.put("/api/settings/scheduling", json={"insert_size_reuse_threshold_bp": 0}).status_code == 422
