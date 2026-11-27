"""reconcile() (services/run_sequencing.py): where MLWH's record of a well disagrees with RunNx's
plan. Flags warn, never block."""
from app.services.mlwh_wells import MlwhWell
from app.services.run_sequencing import Planned, reconcile


def _well(**overrides) -> MlwhWell:
    base = {
        "run_name": "TRACTION-RUN-1", "plate_number": 1, "well_label": "A1", "instrument_name": "84047", "qc_state": "Passed",
        "qc_date": None, "well_start": None, "well_complete": None, "smrt_cell_id": "EA1", "cell_lot": "LOT1", "cell_use_count": 1,
        "is_multi_use": True, "sequencing_kit": None, "movie_name": None, "movie_minutes": 1440, "loading_conc": 250,
        "hifi_read_bases": 12e9, "sl_hostname": None, "sl_run_uuid": None, "tubes": {"TRAC-2-1": {1}},
    }
    return MlwhWell(**(base | overrides))


PLAN = Planned(pool_id="TRAC-2-1", run_time_hours=24, use_number=1, cell_code="C01-T1")


def _kinds(planned, well) -> list[str]:
    return [f.kind for f in reconcile(planned, well)]


def test_a_well_that_matches_the_plan_has_no_flags():
    assert _kinds(PLAN, _well()) == []
    # Pool IDs compare case- and space-insensitively.
    assert _kinds(Planned("  trac-2-1 ", 24, 1, "C01-T1"), _well()) == []


def test_nothing_recorded_yet_has_no_flags():
    assert _kinds(PLAN, None) == []


def test_a_cell_where_runnx_planned_nothing():
    assert _kinds(None, _well()) == ["not_in_plan"]


def test_pool_movie_and_use_disagreements():
    assert _kinds(PLAN, _well(tubes={"TRAC-2-9": {1}})) == ["pool_differs"]
    assert _kinds(PLAN, _well(movie_minutes=1440 + 31)) == ["movie_differs"]
    assert _kinds(PLAN, _well(movie_minutes=1440 - 30)) == []
    assert _kinds(PLAN, _well(cell_use_count=2)) == ["use_differs"]


def test_missing_values_on_either_side_are_not_disagreements():
    assert _kinds(Planned(None, None, None, None), _well(tubes={"X": {1}}, movie_minutes=1, cell_use_count=3)) == []
    assert _kinds(PLAN, _well(tubes={}, movie_minutes=None, cell_use_count=None, smrt_cell_id=None)) == []


def test_a_different_physical_cell_on_another_use():
    planned = Planned("TRAC-2-1", 24, 2, "C01-T1", other_uses=((1, "TRACTION-RUN-0", "EA9"),))
    (flag,) = reconcile(planned, _well(cell_use_count=2))
    assert flag.kind == "cell_differs" and "EA9" in flag.detail and "EA1" in flag.detail
    same = Planned("TRAC-2-1", 24, 2, "C01-T1", other_uses=((1, "TRACTION-RUN-0", "EA1"),))
    assert _kinds(same, _well(cell_use_count=2)) == []
