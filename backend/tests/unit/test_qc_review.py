"""The pure parts of QC Review (services/qc_review.py): which LangQC states are facility failures,
how a Traction run name is normalised, and how MLWH's plate/well finds the RunNx use."""
import pytest

from app.models.schedule import CellUse, Cycle, RunBatch
from app.services.qc_review import _use_at, is_facility_failure, run_key, well_key


@pytest.mark.parametrize(
    ("state", "expected"),
    [
        ("Failed, SMRT cell", True),
        ("Failed, Instrument", True),
        ("failed, smrt cell", True),
        ("Failed, SMRT Cell (contamination)", True),  # a state LangQC might add later
        ("Failed", False),  # the sample missed its metrics - not a facility failure
        ("Passed", False),
        ("On hold", False),
        ("Aborted", False),
        ("", False),
        (None, False),
    ],
)
def test_facility_failures_are_matched_by_shape(state, expected):
    assert is_facility_failure(state) is expected


@pytest.mark.parametrize(
    "name", ["TRACTION-RUN-2589", "traction-run-2589", " Traction Run 2589 ", "TRACTION_RUN_02589", "2589"]
)
def test_run_names_normalise_to_one_key(name):
    assert run_key(name) == "TRACTION-RUN-2589"


def test_other_run_names_are_kept_and_blank_is_none():
    assert run_key("  my special run ") == "MY SPECIAL RUN"
    assert run_key("   ") is None and run_key(None) is None


def test_well_key():
    assert well_key(" TRACTION-RUN-2589 ", 2, "a1") == "TRACTION-RUN-2589|2|A1"


def _run(*plates: tuple[int, list[tuple[str, str]]]) -> RunBatch:
    return RunBatch(
        cycles=[
            Cycle(plate_index=p, cell_uses=[CellUse(well=w, status=s) for w, s in uses]) for p, uses in plates
        ]
    )


def test_traction_well_is_the_runnx_row_letter_on_that_plate():
    run = _run((1, [("A01", "started"), ("B01", "started")]), (2, [("A02", "started")]))
    assert _use_at(run, 1, "B1").well == "B01"
    # A fresh parallel Plate 2 stores A02-D02, but Traction labels every plate A1-D1.
    assert _use_at(run, 2, "A1").well == "A02"
    assert _use_at(run, 2, "B1") is None
    assert _use_at(run, 3, "A1") is None


def test_a_reuse_plate_2_in_a01_is_traction_plate_2_a1_and_blocked_markers_are_skipped():
    run = _run((1, [("A01", "started")]), (2, [("A01", "cancelled")]))
    assert _use_at(run, 2, "A1") is None
    run = _run((1, [("A01", "started")]), (2, [("A01", "started")]))
    assert _use_at(run, 2, "A1") is run.cycles[1].cell_uses[0]
