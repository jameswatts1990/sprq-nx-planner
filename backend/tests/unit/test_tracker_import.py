import csv
import io
from pathlib import Path

from app.engine.csv_parse import parse_csv
from app.engine.tracker_columns import (
    K_BARCODES,
    K_CCS_KINETICS,
    K_PRIORITY,
    K_SANGER,
    K_STATUS,
    K_TARGET_OPLC,
    K_TRACTION_ID,
    TRACKER_COLUMNS,
    TRACKER_HEADER,
)
from app.engine.tracker_import import looks_like_tracker, normalize_tracker

EXAMPLE_CSV = Path(__file__).parent.parent / "fixtures" / "example_samples.csv"


def _tracker_csv(rows: list[dict]) -> str:
    """Build a valid tracker CSV (exact 56-col layout) from field-keyed row dicts."""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(TRACKER_HEADER)
    for row in rows:
        writer.writerow([row.get(key, "") if key else "" for _, key in TRACKER_COLUMNS])
    return buf.getvalue()


def test_looks_like_tracker_true_for_tracker_header():
    text = _tracker_csv([])
    assert looks_like_tracker(parse_csv(text)) is True


def test_looks_like_tracker_false_for_default_and_two_column_formats():
    assert looks_like_tracker(parse_csv(EXAMPLE_CSV.read_text())) is False
    assert looks_like_tracker(parse_csv("TRAC-2-1, bc1\nTRAC-2-2, bc2")) is False


def test_normalize_tracker_maps_p1_fields_and_skips_non_backlog_and_separators():
    text = _tracker_csv(
        [
            {
                K_TRACTION_ID: "TRAC-2-26256",
                K_BARCODES: "bc2074",
                K_SANGER: '["DTOL1","DTOL2"]',
                K_TARGET_OPLC: "300",
                K_PRIORITY: "High",
                K_CCS_KINETICS: "Yes",
                K_STATUS: "Pending",
            },
            # blank status is treated as backlog too
            {K_TRACTION_ID: "TRAC-2-26279", K_BARCODES: "bc2094 bc2095", K_STATUS: ""},
            # already on the instrument -> skipped with a warning
            {K_TRACTION_ID: "TRAC-2-25815", K_BARCODES: "bc2044, bc2052", K_STATUS: "Loaded"},
            # separator / label row: no id, no barcodes -> silently skipped
            {},
            # has an id but no barcodes -> skipped, warned
            {K_TRACTION_ID: "TRAC-2-9999", K_STATUS: "Pending"},
        ]
    )

    result = normalize_tracker(text)
    by_id = {s.id: s for s in result.samples}

    assert set(by_id) == {"TRAC-2-26256", "TRAC-2-26279"}

    s = by_id["TRAC-2-26256"]
    assert s.barcodes == ["bc2074"]
    assert s.sanger == ["DTOL1", "DTOL2"]
    assert s.target_oplc == 300.0
    assert s.priority == "High"
    assert s.ccs_kinetics == "True"  # "Yes" normalized to canonical True/False

    assert by_id["TRAC-2-26279"].barcodes == ["bc2094", "bc2095"]

    # the Loaded row is reported as skipped; the empty separator row is not warned about
    assert any("TRAC-2-25815" in w and "already on instrument" in w for w in result.warnings)
    assert any("TRAC-2-9999" in w and "no barcodes" in w for w in result.warnings)
    assert len(result.warnings) == 2
