"""Golden-fixture test: hand-traced expected packing for the app's own example data and
default settings (max uses 3x, objective "fewest"). Originally a straight port-parity
test against packCells() in revio-nx-planner.html (see PLAN's "porting the algorithms"
section) - the expected assignments below no longer match the prototype byte-for-byte,
because none of this fixture's samples set a priority, which puts External ID
sequencing (see `external_id_sort_key`) in the driver's seat instead of the prototype's
barcode-count/conflict-degree heuristic: since BNCH-1597..1604 are already numerically
sequential, they're now packed in that exact order rather than hardest-to-place-first.
"""
from datetime import datetime, timezone

from app.engine.packing import disjoint, external_id_sort_key, pack_cells, priority_rank
from app.engine.types import ParsedSample, PriorCellInput


def test_disjoint():
    assert disjoint({"a", "b"}, ["c", "d"]) is True
    assert disjoint({"a", "b"}, ["b", "d"]) is False


def test_pack_example_csv_matches_hand_traced_expectation(example_samples):
    result = pack_cells(example_samples, max_uses=3, objective="fewest")

    assert result.unplaced == []
    assert len(result.cells) == 3

    by_id = {c.id: c for c in result.cells}
    assert set(by_id) == {"C1", "C2", "C3"}

    assert [s.id for s in by_id["C1"].uses] == ["BNCH-1597", "BNCH-1598", "BNCH-1599"]
    assert [s.id for s in by_id["C2"].uses] == ["BNCH-1600", "BNCH-1601", "BNCH-1602"]
    assert [s.id for s in by_id["C3"].uses] == ["BNCH-1603", "BNCH-1604"]

    assert by_id["C1"].future_uses == 3 and by_id["C1"].total_uses == 3 and by_id["C1"].cost_tier == 3
    assert by_id["C2"].future_uses == 3 and by_id["C2"].total_uses == 3 and by_id["C2"].cost_tier == 3
    assert by_id["C3"].future_uses == 2 and by_id["C3"].total_uses == 2 and by_id["C3"].cost_tier == 2

    # no cell may carry two samples that share a barcode
    for cell in result.cells:
        seen: set[str] = set()
        for use in cell.uses:
            assert seen.isdisjoint(use.barcodes), f"barcode repeat within {cell.id}"
            seen.update(use.barcodes)

    pairs = {(p.a, p.b, tuple(p.shared)) for p in result.conflict_pairs}
    assert pairs == {
        ("BNCH-1597", "BNCH-1604", ("bc2021",)),
        ("BNCH-1602", "BNCH-1603", ("bc2018",)),
    }


def test_pack_excludes_prior_cell_when_sample_shares_a_burned_barcode():
    # P1 already burned bc1 on a prior use; a new sample carrying bc1 must never
    # land back on P1 even though it still has capacity - this is the rule that
    # replaces the prototype's manual "already burned" bookkeeping.
    prior = [PriorCellInput(barcodes_text="bc1", uses_consumed=1, cell_id=42)]  # max_uses=3 -> remaining=2
    samples = [
        ParsedSample(id="S1", barcodes=["bc1"], key="S1#0"),
        ParsedSample(id="S2", barcodes=["bc2"], key="S2#1"),
    ]

    result = pack_cells(samples, max_uses=3, objective="fewest", prior_cells=prior)

    prior_cell = next(c for c in result.all_cells if c.prior)
    assert prior_cell.remaining == 2
    assert [u.id for u in prior_cell.uses] == ["S2"]  # S1 (bc1) is barred from P1; S2 (bc2) is fine

    fresh_cell = next(c for c in result.cells if not c.prior)
    assert [u.id for u in fresh_cell.uses] == ["S1"]


def test_pack_carries_pinned_well_through_from_prior_cell_input():
    # A cell is physically fixed to one well for life (see engine/slot_scheduling.py's
    # pin enforcement) - pack_cells must pass PriorCellInput.pinned_well through onto
    # the resulting PackedCell unchanged, or fill_slots would have nothing to enforce.
    prior = [PriorCellInput(barcodes_text="", uses_consumed=1, cell_id=42, pinned_well="B01")]
    samples = [ParsedSample(id="S1", barcodes=["bc1"], key="S1#0")]

    result = pack_cells(samples, max_uses=3, objective="fewest", prior_cells=prior)

    prior_cell = next(c for c in result.all_cells if c.prior)
    assert prior_cell.pinned_well == "B01"


def test_pack_marks_samples_unplaced_when_max_uses_is_zero_capacity():
    samples = [ParsedSample(id="S1", barcodes=["bc1"], key="S1#0")]
    result = pack_cells(samples, max_uses=1, objective="fastest")
    assert result.unplaced == []  # cap is 1, so it should place fine

    # force an impossible situation: a prior-only cell already exhausted and max_uses effectively 0
    result2 = pack_cells(samples, max_uses=0, objective="fewest")
    assert [s.id for s in result2.unplaced] == ["S1"]
    assert result2.cells == []


def _disjoint_samples(n: int) -> list[ParsedSample]:
    return [ParsedSample(id=f"S{i}", barcodes=[f"bc{i}"], key=f"S{i}#0") for i in range(n)]


def test_pack_honors_max_uses_regardless_of_objective():
    # Regression test: "balance"/"fastest" used to silently cap fresh-cell depth to 2/1
    # even when the caller explicitly asked for max_uses=3, so a cell would take exactly
    # 2 uses and then a fresh cell would open instead of continuing to reuse - depth must
    # now always reach max_uses when nothing else (like available_days) constrains it.
    for objective in ("fewest", "balance", "fastest"):
        result = pack_cells(_disjoint_samples(5), max_uses=3, objective=objective)
        depths = sorted((len(c.uses) for c in result.cells), reverse=True)
        assert depths == [3, 2], f"objective={objective} produced {depths}"


def test_pack_utilisation_opens_distinct_cells_up_to_cells_per_day_before_deepening():
    # Unlike "fastest" (which only ever reorders candidates that already coexist, and in
    # this no-barcode-conflict case never has more than one open-with-room fresh cell at
    # a time - see the contrast below), "utilisation" refuses to reuse any fresh cell
    # until cells_per_day distinct ones are open, so an instrument-day's wells fill with
    # distinct cells before any of them starts a 2nd use.
    samples = _disjoint_samples(8)
    result = pack_cells(samples, max_uses=3, objective="utilisation", cells_per_day=4)
    assert len(result.cells) == 4
    assert sorted((len(c.uses) for c in result.cells), reverse=True) == [2, 2, 2, 2]
    assert result.unplaced == []

    fastest_result = pack_cells(samples, max_uses=3, objective="fastest")
    assert sorted((len(c.uses) for c in fastest_result.cells), reverse=True) == [3, 3, 2]


def test_pack_utilisation_round_robins_depth_once_width_is_reached():
    samples = _disjoint_samples(12)
    result = pack_cells(samples, max_uses=3, objective="utilisation", cells_per_day=4)
    assert len(result.cells) == 4
    assert sorted((len(c.uses) for c in result.cells), reverse=True) == [3, 3, 3, 3]
    assert result.unplaced == []


def test_pack_utilisation_defaults_width_to_len_wells_when_cells_per_day_omitted():
    samples = _disjoint_samples(6)
    result = pack_cells(samples, max_uses=3, objective="utilisation")
    assert sorted((len(c.uses) for c in result.cells), reverse=True) == [1, 1, 1, 1, 1, 1]


def test_pack_utilisation_still_prefers_reusing_a_prior_cell_over_opening_fresh():
    prior = [PriorCellInput(barcodes_text="", uses_consumed=1, cell_id=42)]  # remaining=2
    samples = [ParsedSample(id="S1", barcodes=["bc1"], key="S1#0")]

    result = pack_cells(samples, max_uses=3, objective="utilisation", prior_cells=prior, cells_per_day=4)

    prior_cell = next(c for c in result.all_cells if c.prior)
    assert [u.id for u in prior_cell.uses] == ["S1"]
    assert not any(not c.prior for c in result.cells)


def test_pack_available_days_caps_depth_below_max_uses():
    # A cell can only be reused once per calendar day, so if only 2 days are actually on
    # offer, planning depth 3 onto a fresh cell would just strand its 3rd use as
    # unplaced - available_days should cap depth to what can really be placed instead.
    result = pack_cells(_disjoint_samples(5), max_uses=3, objective="fewest", available_days=2)
    depths = sorted((len(c.uses) for c in result.cells), reverse=True)
    assert depths == [2, 2, 1]
    assert result.unplaced == []


def test_priority_rank_extracts_trailing_parenthesized_number():
    assert priority_rank("High (1)") == 1
    assert priority_rank("Standard (3)") == 3
    assert priority_rank("no rank here") == 999
    assert priority_rank("") == 999
    assert priority_rank(None) == 999


def test_external_id_sort_key_orders_numerically_and_case_insensitively():
    ids = ["sample 10", "SAMPLE 2", "Sample 1", "sample 9"]
    assert sorted(ids, key=external_id_sort_key) == ["Sample 1", "SAMPLE 2", "sample 9", "sample 10"]


def test_pack_processes_higher_priority_samples_first():
    # S1 has more barcodes (the old primary sort key would have processed it first), but
    # S2 is higher priority - priority must win regardless of the barcode-count heuristic.
    samples = [
        ParsedSample(id="S1", barcodes=["bc1", "bc2"], priority="Standard (3)", key="S1#0"),
        ParsedSample(id="S2", barcodes=["bc3"], priority="High (1)", key="S2#1"),
    ]
    # max_uses=1 (cap 1) forces one fresh cell per sample, so cell creation order
    # directly reveals processing order: whichever sample is handled first becomes C1.
    result = pack_cells(samples, max_uses=1, objective="fewest")
    by_id = {c.id: c.uses[0].id for c in result.cells}
    assert by_id["C1"] == "S2"
    assert by_id["C2"] == "S1"


def test_pack_breaks_priority_and_id_ties_by_oldest_first():
    # Same External ID (e.g. a container reused across two import rows) as well as the
    # same priority, so oldest-first is the only remaining tie-break left to decide it.
    older = ParsedSample(
        id="S1", barcodes=["bc1"], priority="High (1)", key="S1#0", created_at=datetime(2026, 1, 1, tzinfo=timezone.utc)
    )
    newer = ParsedSample(
        id="S1", barcodes=["bc2"], priority="High (1)", key="S2#1", created_at=datetime(2026, 6, 1, tzinfo=timezone.utc)
    )
    # Reverse input order so this only passes if the sort actually reorders by date,
    # not by coincidentally preserving input order.
    result = pack_cells([newer, older], max_uses=1, objective="fewest")
    by_id = {c.id: c.uses[0].key for c in result.cells}
    assert by_id["C1"] == "S1#0"
    assert by_id["C2"] == "S2#1"


def test_pack_breaks_priority_ties_by_external_id_sequence_ahead_of_age():
    # S2 was entered into the backlog first (older created_at), but S1's External ID
    # sorts first - a lab operator loading a sequential plate of samples wants them
    # grouped/ordered by ID, not by whichever happened to be imported first.
    older_but_higher_id = ParsedSample(
        id="S9", barcodes=["bc1"], priority="High (1)", key="S9#0", created_at=datetime(2026, 1, 1, tzinfo=timezone.utc)
    )
    newer_but_lower_id = ParsedSample(
        id="S2", barcodes=["bc2"], priority="High (1)", key="S2#1", created_at=datetime(2026, 6, 1, tzinfo=timezone.utc)
    )
    result = pack_cells([older_but_higher_id, newer_but_lower_id], max_uses=1, objective="fewest")
    by_id = {c.id: c.uses[0].id for c in result.cells}
    assert by_id["C1"] == "S2"
    assert by_id["C2"] == "S9"


def test_pack_external_id_sequencing_uses_natural_numeric_order():
    # Plain lexical sort would put "Sample 10" before "Sample 9" - natural sort must
    # treat the embedded number as a number so sequential plates pack in the order a lab
    # operator actually reads them.
    sample_10 = ParsedSample(id="Sample 10", barcodes=["bc1"], key="s10#0")
    sample_9 = ParsedSample(id="Sample 9", barcodes=["bc2"], key="s9#1")
    result = pack_cells([sample_10, sample_9], max_uses=1, objective="fewest")
    by_id = {c.id: c.uses[0].id for c in result.cells}
    assert by_id["C1"] == "Sample 9"
    assert by_id["C2"] == "Sample 10"
