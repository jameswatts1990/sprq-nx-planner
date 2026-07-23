from app.engine.csv_parse import parse_csv
from app.engine.import_fields import IMPORTABLE_FIELDS, suggest_column_map
from app.engine.normalize import normalize_with_map
from app.engine.tracker_columns import TRACKER_COLUMNS, TRACKER_HEADER
from app.services.import_service import template_csv

DEFAULT_HEADER = [
    "Container", "Parent Sample", "Sanger Sample IDs", "Parent Sample ID",
    "Barcodes", "Volume to Load", "Actual OPLC",
]


def test_suggest_map_default_lims_header():
    m = suggest_column_map(DEFAULT_HEADER)
    assert m["external_id"] == 0  # Container
    assert m["barcodes"] == 4
    assert m["sanger"] == 2
    assert m["parent_sample"] == 1
    assert m["volume"] == 5
    assert m["oplc"] == 6


def test_suggest_map_tracker_header_maps_traction_id_and_complex_batch_id():
    m = suggest_column_map(TRACKER_HEADER)
    assert TRACKER_HEADER[m["external_id"]] == "Traction ID"
    assert TRACKER_HEADER[m["barcodes"]] == "Complex Batch ID"
    assert TRACKER_HEADER[m["sanger"]] == "Sanger Sample ID"


def test_suggest_map_renamed_header_still_finds_barcodes_and_id():
    m = suggest_column_map(["Sample Name", "My Barcodes", "Notes"])
    assert m["external_id"] == 0
    assert m["barcodes"] == 1


def test_normalize_with_map_skips_and_records_barcodeless_rows():
    rows = [
        ["TRAC-1", "bc1 bc2"],
        ["", ""],           # blank separator -> dropped silently
        ["TRAC-2", ""],     # id but no barcode -> skipped, recorded
    ]
    result = normalize_with_map(rows, {"external_id": 0, "barcodes": 1})
    assert [s.id for s in result.samples] == ["TRAC-1"]
    assert result.samples[0].barcodes == ["bc1", "bc2"]
    assert [(s.identifier, s.reason) for s in result.skipped] == [("TRAC-2", "No barcodes")]


def test_template_round_trips_through_the_mapper():
    rows = parse_csv(template_csv())
    assert rows[0] == [f.label for f in IMPORTABLE_FIELDS]  # header == canonical labels
    m = suggest_column_map(rows[0])
    # every canonical field auto-maps back from its own label
    assert set(m) == {f.key for f in IMPORTABLE_FIELDS}
    result = normalize_with_map(rows[1:], m)
    assert len(result.samples) == 1
    s = result.samples[0]
    assert s.id == "TRAC-2-26256"
    assert s.barcodes == ["bc2074", "bc2075"]
    assert s.sanger == ["DTOL16944651"]
    assert s.priority == "High"


def test_tracker_layout_and_importable_fields_stay_independent():
    # sanity: the tracker export spec is a different, larger layout than the import fields
    assert len(TRACKER_COLUMNS) == 56
    assert len(IMPORTABLE_FIELDS) == 12
