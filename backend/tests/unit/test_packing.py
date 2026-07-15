"""Golden-fixture parity test: hand-traced against the packCells() algorithm in
revio-nx-planner.html using the prototype's own example data and default settings
(max uses 3x, objective "fewest"). See PLAN's "porting the algorithms" section.
"""
from app.engine.packing import disjoint, pack_cells
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

    assert [s.id for s in by_id["C1"].uses] == ["BNCH-1598", "BNCH-1597", "BNCH-1602"]
    assert [s.id for s in by_id["C2"].uses] == ["BNCH-1603", "BNCH-1604", "BNCH-1599"]
    assert [s.id for s in by_id["C3"].uses] == ["BNCH-1600", "BNCH-1601"]

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


def test_pack_available_days_caps_depth_below_max_uses():
    # A cell can only be reused once per calendar day, so if only 2 days are actually on
    # offer, planning depth 3 onto a fresh cell would just strand its 3rd use as
    # unplaced - available_days should cap depth to what can really be placed instead.
    result = pack_cells(_disjoint_samples(5), max_uses=3, objective="fewest", available_days=2)
    depths = sorted((len(c.uses) for c in result.cells), reverse=True)
    assert depths == [2, 2, 1]
    assert result.unplaced == []
