"""The pure part of QC Review (services/qc_review.py): which LangQC states are facility failures.
Run-name normalising and plate/well matching are shared - see test_mlwh_wells.py."""
import pytest

from app.services.qc_review import is_facility_failure


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
