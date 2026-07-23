from app.engine.tracker_columns import (
    TRACKER_COLUMNS,
    TRACKER_HEADER,
    TRACKER_KEY_BY_HEADER,
    normalize_header,
)
from app.services.schedule_export_service import _fmt_sanger, sheet_status


def test_layout_is_56_columns_with_two_blanks():
    assert len(TRACKER_HEADER) == 56
    assert TRACKER_HEADER[49] == ""  # separator column before Status
    assert TRACKER_HEADER[55] == ""  # trailing TRUE/FALSE flag column


def test_key_headers_are_at_expected_positions():
    assert TRACKER_HEADER[5] == "Traction ID"
    assert TRACKER_HEADER[10] == "cell location"
    assert TRACKER_HEADER[17] == "Complex Batch ID"  # temporary barcode home
    assert TRACKER_HEADER[50] == "Status"
    assert TRACKER_HEADER[51] == "Prioity"  # [sic]


def test_embedded_newline_headers_are_verbatim():
    assert "Loading Conc.\n(pM)" in TRACKER_HEADER
    assert "Library Size\n(bp)" in TRACKER_HEADER
    assert "Well Status \n(From LangQC)" in TRACKER_HEADER


def test_normalize_header_collapses_newlines():
    assert normalize_header("Loading Conc.\n(pM)") == "loading conc. (pm)"
    assert normalize_header("  Traction  ID ") == "traction id"


def test_import_key_lookup_covers_only_stored_columns():
    # exactly the columns with a non-None key and a non-empty header
    expected = sum(1 for h, k in TRACKER_COLUMNS if k is not None and h)
    assert len(TRACKER_KEY_BY_HEADER) == expected
    assert TRACKER_KEY_BY_HEADER["traction id"] == "traction_id"
    assert TRACKER_KEY_BY_HEADER["complex batch id"] == "barcodes"


def test_sheet_status_mapping():
    assert sheet_status("in_progress", "running") == "Loaded"
    assert sheet_status("in_progress", "planned") == "Loaded"
    assert sheet_status("scheduled", "planned") == "In Progress"
    assert sheet_status("completed", "completed") == ""
    assert sheet_status("failed", "aborted") == ""
    assert sheet_status(None, "running") == "Loaded"


def test_fmt_sanger_single_vs_multiple():
    assert _fmt_sanger([]) == ""
    assert _fmt_sanger(["DTOL1"]) == "DTOL1"
    assert _fmt_sanger(["DTOL1", "DTOL2"]) == '["DTOL1","DTOL2"]'
