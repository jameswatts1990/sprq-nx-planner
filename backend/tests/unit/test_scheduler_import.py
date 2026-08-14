import csv
import io
import json

import pytest

from app.engine.csv_parse import parse_csv
from app.engine.import_fields import suggest_column_map
from app.engine.normalize import normalize_with_map
from app.engine.scheduler_import import (
    SchedulerFormatError,
    convert_scheduler_csv,
    parse_portion,
)

# A representative subset of the scheduler-sheet header (order irrelevant — columns are
# resolved by name). Includes Plate ID + a free-text column so we can assert every column is
# carried through the pool collapse.
HEADER = [
    "Pool ID",
    "Portion of SMRT Cell",
    "Complex Batch ID",
    "Sanger Sample ID",
    "Priority",
    "Target Loading Concentration (pM)",
    "Plate ID",
    "Sequencing Comments",
]
_INDEX = {name: i for i, name in enumerate(HEADER)}
# kwargs can't spell the "(pM)" suffix, so allow the shorter name in _row(...).
_INDEX["Target Loading Concentration"] = _INDEX["Target Loading Concentration (pM)"]


def _row(**cells: str) -> list[str]:
    row = [""] * len(HEADER)
    for name, value in cells.items():
        row[_INDEX[name.replace("_", " ")]] = value
    return row


def _sheet(rows: list[list[str]]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(HEADER)
    writer.writerows(rows)
    return buf.getvalue()


def _pools_by_id(result) -> dict[str, object]:
    return {p.pool_id: p for p in result.pools}


def _cell(result, pool, header_name: str) -> str:
    """A collapsed pool's value under an (original) header name."""
    return pool.row[result.columns.index(header_name)]


# --- portion parsing -----------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("1", 1.0),
        ("1.0", 1.0),
        ("0.5", 0.5),
        ("0.25", 0.25),
        ("50%", 0.5),
        ("100%", 1.0),
        ("50", 0.5),  # whole percent written without the sign
        ("25", 0.25),
        ("", None),
        ("  ", None),
        ("n/a", None),
    ],
)
def test_parse_portion_accepts_fractions_percents_and_wholes(raw, expected):
    assert parse_portion(raw) == expected


# --- pooling by Pool ID --------------------------------------------------------------------


def test_blank_pool_id_rows_continue_the_pool_above():
    text = _sheet(
        [
            # a whole cell on its own
            _row(Pool_ID="POOL-A", Portion_of_SMRT_Cell="1", Complex_Batch_ID="bc01", Sanger_Sample_ID="DTOL1"),
            # lead + a blank-Pool-ID continuation row -> one cell
            _row(Pool_ID="POOL-B", Portion_of_SMRT_Cell="0.5", Complex_Batch_ID="bc02", Sanger_Sample_ID="DTOL2"),
            _row(Portion_of_SMRT_Cell="0.5", Complex_Batch_ID="bc03", Sanger_Sample_ID="DTOL3"),
        ]
    )
    result = convert_scheduler_csv(text)
    assert result.pool_count == 2
    assert result.review_count == 0
    assert result.source_row_count == 3

    pools = _pools_by_id(result)
    assert set(pools) == {"POOL-A", "POOL-B"}
    assert all(p.status == "ok" for p in result.pools)
    # barcodes are combined across the pool
    assert _cell(result, pools["POOL-B"], "Complex Batch ID") == "bc02; bc03"


def test_repeated_pool_id_rows_continue_the_same_pool():
    text = _sheet(
        [
            _row(Pool_ID="POOL-A", Portion_of_SMRT_Cell="0.33", Complex_Batch_ID="bc1"),
            _row(Pool_ID="POOL-A", Portion_of_SMRT_Cell="0.33", Complex_Batch_ID="bc2"),
            _row(Pool_ID="POOL-A", Portion_of_SMRT_Cell="0.33", Complex_Batch_ID="bc3"),
        ]
    )
    result = convert_scheduler_csv(text)
    assert result.pool_count == 1
    pool = _pools_by_id(result)["POOL-A"]
    assert pool.status == "ok"  # 99% is a whole cell within tolerance
    assert pool.portion_percent == 99
    assert len(pool.members) == 3
    assert _cell(result, pool, "Complex Batch ID") == "bc1; bc2; bc3"


def test_three_thirds_pool_is_auto_accepted_as_a_whole_cell():
    text = _sheet(
        [
            _row(Pool_ID="POOL-3", Portion_of_SMRT_Cell="33%", Complex_Batch_ID="bc1"),
            _row(Portion_of_SMRT_Cell="33%", Complex_Batch_ID="bc2"),
            _row(Portion_of_SMRT_Cell="33%", Complex_Batch_ID="bc3"),
        ]
    )
    result = convert_scheduler_csv(text)
    assert result.review_count == 0
    pool = _pools_by_id(result)["POOL-3"]
    assert pool.status == "ok"
    assert pool.portion_percent == 99
    assert [m.portion_percent for m in pool.members] == [33, 33, 33]


def test_a_new_pool_id_closes_the_previous_pool_no_cross_bleed():
    """Two half-cells with DIFFERENT Pool IDs must NOT merge into one 100% pool — Pool ID, not
    the running portion sum, defines the boundary."""
    text = _sheet(
        [
            _row(Pool_ID="POOL-A", Portion_of_SMRT_Cell="0.5", Complex_Batch_ID="bc1"),
            _row(Pool_ID="POOL-B", Portion_of_SMRT_Cell="0.5", Complex_Batch_ID="bc2"),
        ]
    )
    result = convert_scheduler_csv(text)
    assert result.pool_count == 2
    assert result.review_count == 2  # each is only half a cell
    pools = _pools_by_id(result)
    assert pools["POOL-A"].status == "review"
    assert pools["POOL-B"].status == "review"
    assert pools["POOL-A"].portion_percent == 50


def test_short_pool_is_flagged_for_review_not_dropped():
    text = _sheet(
        [
            _row(Pool_ID="WHOLE", Portion_of_SMRT_Cell="1", Complex_Batch_ID="bc1"),
            _row(Pool_ID="HALF", Portion_of_SMRT_Cell="0.5", Complex_Batch_ID="bc2"),
        ]
    )
    result = convert_scheduler_csv(text)
    assert result.pool_count == 2  # nothing dropped
    pools = _pools_by_id(result)
    assert pools["WHOLE"].status == "ok"
    assert pools["HALF"].status == "review"
    assert "50%" in (pools["HALF"].note or "")


def test_oversubscribed_pool_is_flagged_for_review():
    text = _sheet(
        [
            _row(Pool_ID="BIG", Portion_of_SMRT_Cell="0.5", Complex_Batch_ID="bc1"),
            _row(Pool_ID="BIG", Portion_of_SMRT_Cell="0.75", Complex_Batch_ID="bc2"),  # 125%
        ]
    )
    result = convert_scheduler_csv(text)
    pool = _pools_by_id(result)["BIG"]
    assert pool.status == "review"
    assert pool.portion_percent == 125
    assert "125%" in (pool.note or "")


def test_unreadable_portion_flags_the_pool_for_review():
    text = _sheet(
        [
            _row(Pool_ID="P1", Portion_of_SMRT_Cell="0.5", Complex_Batch_ID="bc1"),
            _row(Pool_ID="P1", Portion_of_SMRT_Cell="n/a", Complex_Batch_ID="bc2"),
        ]
    )
    pool = _pools_by_id(convert_scheduler_csv(text))["P1"]
    assert pool.status == "review"
    assert "couldn't be read" in (pool.note or "")


# --- collapse / column preservation --------------------------------------------------------


def test_first_nonempty_wins_for_scalars_and_sanger_combines():
    text = _sheet(
        [
            _row(
                Pool_ID="POOL-X",
                Portion_of_SMRT_Cell="0.5",
                Complex_Batch_ID="bc10",
                Sanger_Sample_ID='["DTOLa","DTOLb"]',  # JSON-array list in one cell
                Priority="High",
                Target_Loading_Concentration="300",
            ),
            _row(
                Portion_of_SMRT_Cell="0.5",
                Complex_Batch_ID="bc10, bc11",  # bc10 duplicate should be deduped
                Sanger_Sample_ID="DTOLb, DTOLc",  # comma list; DTOLb duplicate deduped
                Priority="Low",  # ignored — first non-empty priority wins
                Target_Loading_Concentration="250",  # ignored
            ),
        ]
    )
    result = convert_scheduler_csv(text)
    assert result.pool_count == 1
    pool = _pools_by_id(result)["POOL-X"]

    assert _cell(result, pool, "Priority") == "High"
    assert _cell(result, pool, "Target Loading Concentration (pM)") == "300"
    assert _cell(result, pool, "Complex Batch ID") == "bc10; bc11"
    # multiple Sanger IDs are emitted as a JSON array, deduped, source order preserved
    assert json.loads(_cell(result, pool, "Sanger Sample ID")) == ["DTOLa", "DTOLb", "DTOLc"]


def test_single_sanger_id_emitted_plain_not_as_json_array():
    text = _sheet([_row(Pool_ID="P1", Portion_of_SMRT_Cell="1", Complex_Batch_ID="bc1", Sanger_Sample_ID="DTOL1")])
    result = convert_scheduler_csv(text)
    assert _cell(result, _pools_by_id(result)["P1"], "Sanger Sample ID") == "DTOL1"


def test_all_columns_are_carried_through_and_portion_column_is_dropped():
    text = _sheet(
        [
            _row(
                Pool_ID="P1",
                Portion_of_SMRT_Cell="1",
                Complex_Batch_ID="bc1",
                Plate_ID="PLATE-9",
                Sequencing_Comments="run me first",
            )
        ]
    )
    result = convert_scheduler_csv(text)
    # every original column except Portion survives, in order
    assert "Portion of SMRT Cell" not in result.columns
    assert result.columns == [h for h in HEADER if h != "Portion of SMRT Cell"]
    pool = _pools_by_id(result)["P1"]
    assert _cell(result, pool, "Plate ID") == "PLATE-9"
    assert _cell(result, pool, "Sequencing Comments") == "run me first"


def test_trailing_unrelated_row_is_ignored_silently():
    # A totals/notes row whose only value sits in an unrelated column (no Pool ID, no
    # portion, no barcode) — the sheet is full of these and they must not form a pool.
    text = _sheet(
        [
            _row(Pool_ID="P1", Portion_of_SMRT_Cell="1", Complex_Batch_ID="bc1"),
            _row(Sequencing_Comments="Grand total for the plate"),
        ]
    )
    result = convert_scheduler_csv(text)
    assert result.pool_count == 1
    assert set(_pools_by_id(result)) == {"P1"}


def test_missing_required_column_raises_format_error():
    text = "Some Sheet,Of Nonsense\nfoo,bar"
    with pytest.raises(SchedulerFormatError) as exc:
        convert_scheduler_csv(text)
    msg = str(exc.value)
    assert "Pool ID" in msg and "Portion of SMRT Cell" in msg


# --- end-to-end through the ordinary importer ----------------------------------------------


def _assemble(result) -> str:
    """Rebuild the import CSV from the pools' rows, as the frontend does before commit."""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(result.columns)
    writer.writerows(p.row for p in result.pools)
    return buf.getvalue()


def test_pooled_rows_auto_map_and_import_through_the_normal_path():
    text = _sheet(
        [
            _row(Pool_ID="POOL-1", Portion_of_SMRT_Cell="0.5", Complex_Batch_ID="bc1", Sanger_Sample_ID="DTOL1"),
            _row(Portion_of_SMRT_Cell="0.5", Complex_Batch_ID="bc2", Sanger_Sample_ID="DTOL2"),
        ]
    )
    rows = parse_csv(_assemble(convert_scheduler_csv(text)))
    column_map = suggest_column_map(rows[0])
    assert column_map["pool_id"] is not None
    assert column_map["barcodes"] is not None
    assert column_map["sanger"] is not None

    normalized = normalize_with_map(rows[1:], column_map)
    assert len(normalized.samples) == 1
    sample = normalized.samples[0]
    assert sample.id == "POOL-1"
    assert sample.barcodes == ["bc1", "bc2"]
    assert sample.sanger == ["DTOL1", "DTOL2"]


def test_loading_volumes_carry_from_the_scheduler_sheet_and_auto_map():
    """The scheduler sheet's own long-form dilution-volume headers are carried through unchanged
    and still auto-map into the batch-sheet-only ParsedSample fields (fuzzy substring match)."""
    header = [
        "Pool ID",
        "Portion of SMRT Cell",
        "Complex Batch ID",
        "Cleaned complex volume for desired OPLC (uL)",
        "Loading buffer volume (uL)",
    ]
    row = ["POOL-1", "1", "bc1", "8", "6"]
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerows([header, row])

    result = convert_scheduler_csv(buf.getvalue())
    rows = parse_csv(_assemble(result))
    normalized = normalize_with_map(rows[1:], suggest_column_map(rows[0]))
    sample = normalized.samples[0]
    assert sample.cleaned_complex_volume == 8
    assert sample.loading_buffer_volume == 6
