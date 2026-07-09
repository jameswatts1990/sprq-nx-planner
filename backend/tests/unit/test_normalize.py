from pathlib import Path

from app.engine.normalize import normalize_samples

FIXTURE = Path(__file__).parent.parent / "fixtures" / "example_samples.csv"


def load_example_text() -> str:
    return FIXTURE.read_text()


def test_normalize_example_csv_produces_eight_samples_with_expected_fields():
    result = normalize_samples(load_example_text())
    assert result.warnings == []
    assert [s.id for s in result.samples] == [
        "BNCH-1597",
        "BNCH-1598",
        "BNCH-1599",
        "BNCH-1600",
        "BNCH-1601",
        "BNCH-1602",
        "BNCH-1603",
        "BNCH-1604",
    ]

    by_id = {s.id: s for s in result.samples}

    s1597 = by_id["BNCH-1597"]
    assert s1597.barcodes == ["bc2021", "bc2066"]
    assert s1597.parent == "TRAC-2-25402"
    assert s1597.sanger == ["DTOL16756088", "AEGISDNA16711039"]
    assert s1597.oplc == 268.0
    assert s1597.volume == 24.0

    s1598 = by_id["BNCH-1598"]
    assert s1598.barcodes == ["bc2029", "bc2030", "bc2040", "bc2057"]
    assert s1598.volume == 13.19

    # non-JSON sanger value falls back to a single-element list of the raw string
    s1599 = by_id["BNCH-1599"]
    assert s1599.sanger == ["AEGISDNA16711029"]
    assert s1599.barcodes == ["bc2011"]

    # duplicate barcode bc2018 across two distinct samples - both parse fine,
    # the packer is responsible for keeping them off the same cell
    assert by_id["BNCH-1602"].barcodes == ["bc2018"]
    assert by_id["BNCH-1603"].barcodes == ["bc2018"]


def test_normalize_no_header_falls_back_to_two_column_format():
    text = "TRAC-2-25402, bc2021 bc2066\nTRAC-2-25403, bc2029 bc2030 bc2040 bc2057"
    result = normalize_samples(text)
    assert len(result.warnings) == 1
    assert "No header row detected" in result.warnings[0]
    assert [s.id for s in result.samples] == ["TRAC-2-25402", "TRAC-2-25403"]
    assert result.samples[0].barcodes == ["bc2021", "bc2066"]
    assert result.samples[1].barcodes == ["bc2029", "bc2030", "bc2040", "bc2057"]


def test_normalize_row_without_barcodes_is_skipped_with_warning():
    text = "sample,barcodes\nA,bc1\nB,\nC,bc3"
    result = normalize_samples(text)
    assert [s.id for s in result.samples] == ["A", "C"]
    assert any("B" in w and "no barcodes" in w for w in result.warnings)


def test_normalize_empty_text_returns_no_rows_warning():
    result = normalize_samples("")
    assert result.samples == []
    assert result.warnings == ["No rows found in the pasted text."]


def test_normalize_zero_oplc_is_treated_as_none_matching_js_falsy_quirk():
    text = 'sample,barcodes,Actual OPLC\nA,bc1,0\nB,bc2,150'
    result = normalize_samples(text)
    by_id = {s.id: s for s in result.samples}
    assert by_id["A"].oplc is None
    assert by_id["B"].oplc == 150.0
