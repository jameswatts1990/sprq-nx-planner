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
# resolved by name). Includes Plate ID so we can assert it's dropped.
HEADER = [
    "Pool ID",
    "Portion of SMRT Cell",
    "Complex Batch ID",
    "Sanger Sample ID",
    "Priority",
    "Target Loading Concentration (pM)",
    "Plate ID",
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


def _by_container(csv_text: str) -> dict[str, dict[str, str]]:
    """Parse the emitted standard CSV back into {Container ID: {header: value}}."""
    rows = parse_csv(csv_text)
    header = rows[0]
    out: dict[str, dict[str, str]] = {}
    for r in rows[1:]:
        record = dict(zip(header, r))
        out[record["Container ID"]] = record
    return out


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


# --- pooling --------------------------------------------------------------------------------


def test_pools_individual_half_and_quarter_cells_into_containers():
    text = _sheet(
        [
            # a whole cell on its own
            _row(Pool_ID="POOL-A", Portion_of_SMRT_Cell="1", Complex_Batch_ID="bc01", Sanger_Sample_ID="DTOL1"),
            # two halves -> one cell
            _row(Pool_ID="POOL-B", Portion_of_SMRT_Cell="0.5", Complex_Batch_ID="bc02", Sanger_Sample_ID="DTOL2"),
            _row(Portion_of_SMRT_Cell="0.5", Complex_Batch_ID="bc03", Sanger_Sample_ID="DTOL3"),
            # quarter + quarter + half -> one cell (mixed)
            _row(Pool_ID="POOL-C", Portion_of_SMRT_Cell="0.25", Complex_Batch_ID="bc04"),
            _row(Portion_of_SMRT_Cell="0.25", Complex_Batch_ID="bc05"),
            _row(Portion_of_SMRT_Cell="0.5", Complex_Batch_ID="bc06"),
        ]
    )
    result = convert_scheduler_csv(text)
    assert result.pool_count == 3
    assert result.source_row_count == 6

    containers = _by_container(result.csv)
    assert set(containers) == {"POOL-A", "POOL-B", "POOL-C"}
    # barcodes are combined across the pool
    assert containers["POOL-B"]["Barcodes"] == "bc02; bc03"
    assert containers["POOL-C"]["Barcodes"] == "bc04; bc05; bc06"


def test_first_nonempty_wins_for_id_priority_oplc_and_sanger_combines():
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
    rec = _by_container(result.csv)["POOL-X"]

    assert rec["Priority"] == "High"
    assert rec["Target OPLC (pM)"] == "300"
    assert rec["Barcodes"] == "bc10; bc11"
    # multiple Sanger IDs are emitted as a JSON array, deduped, source order preserved
    assert json.loads(rec["Sanger Sample IDs"]) == ["DTOLa", "DTOLb", "DTOLc"]


def test_single_sanger_id_emitted_plain_not_as_json_array():
    text = _sheet([_row(Pool_ID="P1", Portion_of_SMRT_Cell="1", Complex_Batch_ID="bc1", Sanger_Sample_ID="DTOL1")])
    rec = _by_container(convert_scheduler_csv(text).csv)["P1"]
    assert rec["Sanger Sample IDs"] == "DTOL1"


def test_overshoot_group_is_skipped_with_warning():
    text = _sheet(
        [
            _row(Pool_ID="BAD", Portion_of_SMRT_Cell="0.5", Complex_Batch_ID="bc1"),
            _row(Portion_of_SMRT_Cell="0.75", Complex_Batch_ID="bc2"),  # 0.5 + 0.75 = 125%
            _row(Pool_ID="GOOD", Portion_of_SMRT_Cell="1", Complex_Batch_ID="bc3"),
        ]
    )
    result = convert_scheduler_csv(text)
    assert result.pool_count == 1
    assert set(_by_container(result.csv)) == {"GOOD"}
    assert any("BAD" in w and "125%" in w for w in result.warnings)


def test_incomplete_trailing_group_is_reported():
    text = _sheet(
        [
            _row(Pool_ID="WHOLE", Portion_of_SMRT_Cell="1", Complex_Batch_ID="bc1"),
            _row(Pool_ID="PARTIAL", Portion_of_SMRT_Cell="0.5", Complex_Batch_ID="bc2"),  # never completes
        ]
    )
    result = convert_scheduler_csv(text)
    assert result.pool_count == 1
    assert any("PARTIAL" in w and "50%" in w for w in result.warnings)


def test_trailing_unrelated_row_is_ignored_silently():
    # A totals/notes row whose only value sits in an unrelated column (no Pool ID, no
    # portion, no barcode) — the sheet is full of these and they must not warn.
    header = HEADER + ["Sequencing Comments"]
    good = [""] * len(header)
    good[_INDEX["Pool ID"]] = "P1"
    good[_INDEX["Portion of SMRT Cell"]] = "1"
    good[_INDEX["Complex Batch ID"]] = "bc1"
    totals = [""] * len(header)
    totals[-1] = "Grand total for the plate"

    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerows([header, good, totals])

    result = convert_scheduler_csv(buf.getvalue())
    assert result.pool_count == 1
    assert not any("total" in w.lower() for w in result.warnings)


def test_plate_id_column_is_dropped_with_a_note():
    text = _sheet([_row(Pool_ID="P1", Portion_of_SMRT_Cell="1", Complex_Batch_ID="bc1", Plate_ID="PLATE-9")])
    result = convert_scheduler_csv(text)
    assert "Plate ID" not in result.csv.splitlines()[0]
    assert any("Plate ID" in w for w in result.warnings)


def test_missing_required_column_raises_format_error():
    text = "Some Sheet,Of Nonsense\nfoo,bar"
    with pytest.raises(SchedulerFormatError) as exc:
        convert_scheduler_csv(text)
    msg = str(exc.value)
    assert "Pool ID" in msg and "Portion of SMRT Cell" in msg


def test_emitted_csv_auto_maps_and_imports_through_the_normal_path():
    """The converted CSV's headers must be recognised by the ordinary importer end-to-end."""
    text = _sheet(
        [
            _row(
                Pool_ID="POOL-1",
                Portion_of_SMRT_Cell="0.5",
                Complex_Batch_ID="bc1",
                Sanger_Sample_ID="DTOL1",
            ),
            _row(Portion_of_SMRT_Cell="0.5", Complex_Batch_ID="bc2", Sanger_Sample_ID="DTOL2"),
        ]
    )
    converted = convert_scheduler_csv(text).csv
    rows = parse_csv(converted)
    column_map = suggest_column_map(rows[0])
    # the five emitted columns all auto-map
    assert column_map["external_id"] is not None
    assert column_map["barcodes"] is not None
    assert column_map["sanger"] is not None

    normalized = normalize_with_map(rows[1:], column_map)
    assert len(normalized.samples) == 1
    sample = normalized.samples[0]
    assert sample.id == "POOL-1"
    assert sample.barcodes == ["bc1", "bc2"]
    assert sample.sanger == ["DTOL1", "DTOL2"]
