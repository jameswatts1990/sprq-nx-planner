from app.engine.csv_parse import parse_csv
from app.engine.import_fields import IMPORTABLE_FIELDS, suggest_column_map
from app.engine.normalize import normalize_with_map
from app.engine.tracker_columns import TRACKER_COLUMNS, TRACKER_HEADER
from app.services.import_service import template_csv

DEFAULT_HEADER = [
    "Container", "Parent Sample", "Sanger Sample IDs", "Parent Sample ID",
    "Barcodes", "Actual OPLC", "Target OPLC",
]


def test_suggest_map_default_lims_header():
    m = suggest_column_map(DEFAULT_HEADER)
    assert m["pool_id"] == 0  # Container -> the "Pool ID" field
    assert m["barcodes"] == 4
    assert m["sanger"] == 2
    assert m["plate_id"] == 1
    assert m["actual_oplc"] == 5
    assert m["target_oplc"] == 6


def test_suggest_map_pool_id_and_plate_id_headers():
    # A file whose headers are literally "Pool ID" / "Plate ID" auto-maps to the pool_id /
    # plate_id fields (the lab's tracker-sheet vocabulary).
    m = suggest_column_map(["Pool ID", "Barcodes", "Plate ID", "Sanger Sample IDs"])
    assert m["pool_id"] == 0
    assert m["plate_id"] == 2


def test_suggest_map_tracker_header_maps_pool_id_plate_id_and_complex_batch_id():
    # The tracker sheet has both a "Pool ID" and a "Plate ID" column; the app's identity field
    # auto-maps to "Pool ID" (its own name) and the Plate ID field to "Plate ID", matching the
    # pooling importer's own use of Pool ID as the sample identity.
    m = suggest_column_map(TRACKER_HEADER)
    assert TRACKER_HEADER[m["pool_id"]] == "Pool ID"
    assert TRACKER_HEADER[m["plate_id"]] == "Plate ID"
    assert TRACKER_HEADER[m["barcodes"]] == "Complex Batch ID"
    assert TRACKER_HEADER[m["sanger"]] == "Sanger Sample ID"


def test_suggest_map_tracker_header_maps_the_scheduler_sheet_value_columns():
    # The tracker sheet names three of the app's fields differently; each must land on the
    # right column and not on a similarly-named neighbour.
    m = suggest_column_map(TRACKER_HEADER)
    # "Loading Conc." is the achieved value; the sheet also has "Target Loading Concentration"
    # (earlier) and "Max possible Loading Conc." (immediately before) that must not win.
    assert TRACKER_HEADER[m["actual_oplc"]] == "Loading Conc.\n(pM)"
    assert TRACKER_HEADER[m["target_oplc"]] == "Target Loading Concentration (pM)"
    assert TRACKER_HEADER[m["insert_size_bp"]] == "Library Size\n(bp)"
    assert TRACKER_HEADER[m["adaptive_loading"]] == "Pre Extention time (Mins)"


def test_suggest_map_library_pool_volume_from_tracker_sheet():
    # The Google Sheet names it "Library Volume Taken for Complex (uL)" - it must land there,
    # not on "Library Size (bp)" (Insert Size) or any of the other volume columns.
    m = suggest_column_map(TRACKER_HEADER)
    assert TRACKER_HEADER[m["library_pool_volume_used"]] == "Library Volume Taken for Complex (uL)"
    assert TRACKER_HEADER[m["insert_size_bp"]] == "Library Size\n(bp)"
    assert TRACKER_HEADER[m["cleaned_complex_volume"]] == "Cleaned complex volume for desired OPLC (uL)"
    assert TRACKER_HEADER[m["loading_buffer_volume"]] == "Loading buffer volume (uL)"


def test_suggest_map_library_pool_volume_from_benchling_export():
    # A Benchling "Load a Sequencer" export: the volume column maps by its own name, and no
    # other field claims it (nor does it claim the Pool ID / Container column).
    header = DEFAULT_HEADER + ["Task ID", "Task Status", "Volume of Library Pool Used (uL)"]
    m = suggest_column_map(header)
    assert m["library_pool_volume_used"] == len(header) - 1
    assert m["pool_id"] == 0
    assert [k for k, i in m.items() if i == len(header) - 1] == ["library_pool_volume_used"]


def test_library_pool_volume_is_import_only_and_parsed_as_a_number():
    field = next(f for f in IMPORTABLE_FIELDS if f.key == "library_pool_volume_used")
    assert field.import_only is True
    m = {"pool_id": 0, "barcodes": 1, "library_pool_volume_used": 2}
    result = normalize_with_map([["TRAC-1", "bc1", "4.5"], ["TRAC-2", "bc2", ""]], m)
    assert [s.library_pool_volume_used for s in result.samples] == [4.5, None]


def test_suggest_map_adaptive_loading_accepts_tidied_pre_extension_spellings():
    for header in ("Pre Extension Time (Mins)", "Pre-extension time", "Pre-Extention Time"):
        assert suggest_column_map(["Pool ID", "Barcodes", header])["adaptive_loading"] == 2


def test_tracker_pre_extension_cell_reading_adaptive_imports_as_true():
    # The lab writes "adaptive" in the pre-extension column when adaptive loading was used.
    m = {"pool_id": 0, "barcodes": 1, "adaptive_loading": 2}
    result = normalize_with_map([["TRAC-1", "bc1", "Adaptive"], ["TRAC-2", "bc1", ""]], m)
    assert [s.adaptive_loading for s in result.samples] == ["True", None]


def test_suggest_map_renamed_header_still_finds_barcodes_and_id():
    m = suggest_column_map(["Sample Name", "My Barcodes", "Notes"])
    assert m["pool_id"] == 0
    assert m["barcodes"] == 1


def test_normalize_with_map_skips_and_records_barcodeless_rows():
    rows = [
        ["TRAC-1", "bc1 bc2"],
        ["", ""],           # blank separator -> dropped silently
        ["TRAC-2", ""],     # id but no barcode -> skipped, recorded
    ]
    result = normalize_with_map(rows, {"pool_id": 0, "barcodes": 1})
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
    assert s.priority == "High (1)"  # template example "High (1)" round-trips as the canonical label


def test_tracker_layout_and_importable_fields_stay_independent():
    # sanity: the tracker export spec is a different, larger layout than the import fields
    assert len(TRACKER_COLUMNS) == 56
    assert len(IMPORTABLE_FIELDS) == 15
