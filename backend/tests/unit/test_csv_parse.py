from app.engine.csv_parse import parse_csv, split_barcodes


def test_parse_csv_handles_quoted_commas():
    text = 'a,"b,c",d\n1,2,3'
    assert parse_csv(text) == [["a", "b,c", "d"], ["1", "2", "3"]]


def test_parse_csv_handles_escaped_quotes():
    text = 'a,"say ""hi"" now"'
    assert parse_csv(text) == [["a", 'say "hi" now']]


def test_parse_csv_handles_crlf_line_endings():
    text = "a,b\r\n1,2\r\n"
    assert parse_csv(text) == [["a", "b"], ["1", "2"]]


def test_parse_csv_drops_blank_rows():
    text = "a,b\n\n1,2\n,\n"
    assert parse_csv(text) == [["a", "b"], ["1", "2"]]


def test_parse_csv_none_input_returns_empty():
    assert parse_csv(None) == []


def test_split_barcodes_splits_on_multiple_delimiters_and_dedupes():
    assert split_barcodes("bc2021, bc2066;bc2021/bc2099") == ["bc2021", "bc2066", "bc2099"]


def test_split_barcodes_empty_or_none_returns_empty_list():
    assert split_barcodes("") == []
    assert split_barcodes(None) == []


def test_split_barcodes_preserves_first_occurrence_order():
    assert split_barcodes("bc3 bc1 bc2 bc1") == ["bc3", "bc1", "bc2"]
