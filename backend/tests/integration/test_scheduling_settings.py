"""The admin-configurable scheduling settings (insert-size reuse threshold, default run start
hour, default movie length, movie->cell-position rules): the settings_service get/set/validate
helpers, the /api/settings/scheduling endpoints, and the read-only /api/settings/facts card."""
import json

import pytest

from app.engine.constants import (
    CELL_LIFETIME_H,
    CELL_MAX_USES,
    CELLS_PER_TRAY,
    DAY_START_HOUR,
    DEFAULT_INSERT_SIZE_REUSE_THRESHOLD_BP,
    DEFAULT_MOVIE_HOURS,
    MOVIE_HOURS_CHOICES,
)
from app.services.settings_service import (
    get_day_start_hour,
    get_default_movie_hours,
    get_insert_size_reuse_threshold,
    get_movie_cell_position,
    get_movie_rules,
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


# --- day start hour ----------------------------------------------------------------------

def test_day_start_hour_defaults_and_round_trips(db_session):
    assert get_day_start_hour(db_session) == DAY_START_HOUR
    set_scheduling_settings(db_session, {"day_start_hour": "8"})
    assert get_day_start_hour(db_session) == 8


def test_day_start_hour_rejects_out_of_range(db_session):
    for bad in ("-1", "24", "noon"):
        with pytest.raises(ValueError):
            set_scheduling_settings(db_session, {"day_start_hour": bad})


# --- default movie length ----------------------------------------------------------------

def test_default_movie_hours_defaults_and_round_trips(db_session):
    assert get_default_movie_hours(db_session) == DEFAULT_MOVIE_HOURS
    other = next(h for h in MOVIE_HOURS_CHOICES if h != DEFAULT_MOVIE_HOURS)
    set_scheduling_settings(db_session, {"default_movie_hours": str(other)})
    assert get_default_movie_hours(db_session) == other


def test_default_movie_hours_must_be_a_valid_choice(db_session):
    with pytest.raises(ValueError):
        set_scheduling_settings(db_session, {"default_movie_hours": "18"})


# --- movie -> cell-position rules --------------------------------------------------------

def test_movie_cell_position_defaults_to_the_builtin(db_session):
    # Built-in: 12h -> cell 1 (pos 0), 30h -> cell 4 (pos 3), 24h unrestricted (None).
    rules = get_movie_cell_position(db_session)
    assert rules[12] == 0
    assert rules[30] == CELLS_PER_TRAY - 1
    assert rules[24] is None
    # One entry per movie choice, always.
    assert set(rules) == set(MOVIE_HOURS_CHOICES)


def test_movie_cell_position_round_trips_and_feeds_movie_rules(db_session):
    # Flip 12h to unrestricted (any) and confine 24h to cell 2 (pos 1). The service stores the
    # map as JSON text (the API json-encodes it before calling), so pass a JSON string here.
    set_scheduling_settings(db_session, {"movie_cell_position": json.dumps({"12": None, "24": 1, "30": 3})})
    rules = get_movie_cell_position(db_session)
    assert rules[12] is None
    assert rules[24] == 1
    assert rules[30] == 3
    # get_movie_rules bundles the same map + the default length for the engine.
    mr = get_movie_rules(db_session)
    assert mr.positions[24] == 1
    assert mr.default_hours == get_default_movie_hours(db_session)


def test_movie_cell_position_rejects_bad_position_and_unknown_length(db_session):
    with pytest.raises(ValueError):
        set_scheduling_settings(db_session, {"movie_cell_position": json.dumps({"12": CELLS_PER_TRAY})})  # out of range
    with pytest.raises(ValueError):
        set_scheduling_settings(db_session, {"movie_cell_position": json.dumps({"18": 0})})  # not a movie choice


# --- API: full scheduling round-trip incl. the new fields --------------------------------

def test_scheduling_api_returns_and_updates_all_fields(client):
    r = client.get("/api/settings/scheduling").json()
    assert r["day_start_hour"] == DAY_START_HOUR
    assert r["default_movie_hours"] == DEFAULT_MOVIE_HOURS
    # JSON object keys are strings on the wire.
    assert r["movie_cell_position"]["12"] == 0
    assert r["movie_cell_position"]["24"] is None

    put = client.put(
        "/api/settings/scheduling",
        json={"day_start_hour": 9, "default_movie_hours": 30, "movie_cell_position": {"12": None, "24": 0, "30": 3}},
    )
    assert put.status_code == 200
    body = put.json()
    assert body["day_start_hour"] == 9
    assert body["default_movie_hours"] == 30
    assert body["movie_cell_position"]["24"] == 0
    assert body["movie_cell_position"]["12"] is None

    # Out-of-range hour is a 422.
    assert client.put("/api/settings/scheduling", json={"day_start_hour": 25}).status_code == 422


# --- read-only facts card ----------------------------------------------------------------

def test_scheduling_facts_expose_the_vendor_locked_constants(client):
    facts = client.get("/api/settings/facts").json()
    assert facts["cell_lifetime_h"] == CELL_LIFETIME_H
    assert facts["cell_max_uses"] == CELL_MAX_USES
    assert facts["cells_per_tray"] == CELLS_PER_TRAY
    assert facts["movie_hours_choices"] == list(MOVIE_HOURS_CHOICES)
    assert len(facts["wells"]) == 8
    # The timing ladder mirrors cell_timing.py.
    assert facts["timing"]["seq_lanes"] == 4
    assert facts["timing"]["ppa_lanes"] == 2
    assert facts["timing"]["prep_h"] == 4.0
