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

from app.engine.constants import ALL_CELL_POSITIONS, DEFAULT_MOVIE_RULES, MovieRules, movie_allowed_positions
from app.engine.packing import disjoint, external_id_sort_key, pack_cells, priority_rank
from app.engine.types import ParsedSample, PriorCellInput


def test_disjoint():
    assert disjoint({"a", "b"}, ["c", "d"]) is True
    assert disjoint({"a", "b"}, ["b", "d"]) is False


def test_movie_allowed_positions_honours_custom_rules():
    # Default rules: 12h confined to cell 1 (pos 0), 24h unrestricted.
    assert movie_allowed_positions(12) == frozenset({0})
    assert movie_allowed_positions(24) == ALL_CELL_POSITIONS

    # A lab that frees 12h (any cell) and confines 24h to cell 2 (pos 1) - the engine reads the
    # supplied MovieRules, so pack_cells/fill_slots honour an edited Settings > Movie scheduling rule.
    edited = MovieRules(positions={12: None, 24: 1, 30: 3}, default_hours=24)
    assert movie_allowed_positions(12, edited) == ALL_CELL_POSITIONS
    assert movie_allowed_positions(24, edited) == frozenset({1})
    assert movie_allowed_positions(30, edited) == frozenset({3})

    # A None movie time falls back to the rules' own default length.
    assert movie_allowed_positions(None, edited) == movie_allowed_positions(24, edited)
    assert movie_allowed_positions(None, DEFAULT_MOVIE_RULES) == ALL_CELL_POSITIONS  # default 24h = any


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


def test_pack_allows_prior_cell_reuse_for_the_same_duplicate_container_id():
    # P1 already burned bc1, but the owner data says it was S1 itself (an earlier duplicate
    # copy of the same Container ID) that burned it - reusing P1 for another copy of S1 is
    # allowed: it's the same physical material either way, no cross-sample contamination
    # risk (see docs/pacbio-sprq-nx-scheduling-reference.md's barcode-carryover exception).
    prior = [
        PriorCellInput(
            barcodes_text="bc1", barcode_owners={"bc1": frozenset({"S1"})}, uses_consumed=1, cell_id=42
        )
    ]
    samples = [ParsedSample(id="S1", barcodes=["bc1"], key="S1#0")]

    result = pack_cells(samples, max_uses=3, objective="fewest", prior_cells=prior)

    prior_cell = next(c for c in result.all_cells if c.prior)
    assert [u.id for u in prior_cell.uses] == ["S1"]
    assert result.unplaced == []


def test_pack_still_blocks_a_different_sample_sharing_a_barcode_even_with_owner_data():
    # Same prior cell/owner data as above, but the new sample is a genuinely DIFFERENT
    # Container ID sharing the identical barcode - a real foreign clash, still blocked.
    prior = [
        PriorCellInput(
            barcodes_text="bc1", barcode_owners={"bc1": frozenset({"S1"})}, uses_consumed=1, cell_id=42
        )
    ]
    samples = [ParsedSample(id="S2", barcodes=["bc1"], key="S2#0")]

    result = pack_cells(samples, max_uses=3, objective="fewest", prior_cells=prior)

    prior_cell = next(c for c in result.all_cells if c.prior)
    assert prior_cell.uses == []
    fresh_cell = next(c for c in result.cells if not c.prior)
    assert [u.id for u in fresh_cell.uses] == ["S2"]


def test_pack_lets_duplicate_container_id_copies_share_a_fresh_cell():
    # Two copies of the SAME Container ID (same external_id, same barcode - the "duplicate"
    # sample feature), no prior cells at all: the second copy must be able to deepen the
    # very fresh cell the first copy just opened, not be forced onto a brand-new one - this
    # exercises the fresh-cell owner-seeding path (a freshly opened cell's own first use has
    # to register its owner too, or its second use looks "unowned" and is wrongly blocked).
    samples = [
        ParsedSample(id="DUP", barcodes=["bc1"], key="dup#0"),
        ParsedSample(id="DUP", barcodes=["bc1"], key="dup#1"),
    ]

    result = pack_cells(samples, max_uses=3, objective="fewest")

    assert len(result.cells) == 1
    assert [u.key for u in result.cells[0].uses] == ["dup#0", "dup#1"]
    assert result.unplaced == []


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


def test_pack_does_not_co_pack_a_12h_and_a_30h_sample():
    # A 12h sample needs cell 1 and a 30h needs cell 4 - one physical cell can't be both, so
    # even with disjoint barcodes and room to deepen they must land on separate cells.
    samples = [
        ParsedSample(id="S12", barcodes=["b12"], key="S12#0", movie_time=12),
        ParsedSample(id="S30", barcodes=["b30"], key="S30#1", movie_time=30),
    ]
    result = pack_cells(samples, max_uses=3, objective="fewest")
    assert len(result.cells) == 2
    assert all(len(c.uses) == 1 for c in result.cells)


def test_pack_co_packs_a_12h_and_a_24h_sample_onto_one_cell():
    # 12h -> cell 1, 24h -> any cell (incl. cell 1), so they can share one physical cell (both
    # valid at position 1). objective "fewest" deepens onto the same cell rather than opening
    # a second one.
    samples = [
        ParsedSample(id="S12", barcodes=["b12"], key="S12#0", movie_time=12),
        ParsedSample(id="S24", barcodes=["b24"], key="S24#1", movie_time=24),
    ]
    result = pack_cells(samples, max_uses=3, objective="fewest")
    assert len(result.cells) == 1
    assert {s.id for s in result.cells[0].uses} == {"S12", "S24"}


def test_pack_keeps_a_12h_sample_off_a_prior_cell_at_a_middle_position():
    # A prior cell physically fixed to cell 2 (home well B01) can never take a 12h sample
    # (12h -> cell 1 only), even with a disjoint barcode and remaining capacity - the 12h
    # sample opens a fresh cell instead.
    prior = [PriorCellInput(barcodes_text="bprior", uses_consumed=1, cell_id=7, pinned_well="B01")]
    samples = [ParsedSample(id="S12", barcodes=["b12"], key="S12#0", movie_time=12)]

    result = pack_cells(samples, max_uses=3, objective="fewest", prior_cells=prior)

    placed = {c.id: [s.id for s in c.uses] for c in result.cells}
    assert placed == {"C1": ["S12"]}  # fresh cell only; the prior cell (P1) took nothing


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


def test_pack_caps_prior_cell_reuse_at_the_dial():
    # The Max-uses dial is a per-cell TOTAL-use cap for prior cells too, not just fresh
    # ones. A never-used open sibling (uses_consumed=0, remaining=3) offered under a 1x
    # dial must take at most ONE sample this batch, not be stacked toward its physical 3 -
    # otherwise the dial silently wouldn't apply to reuse candidates.
    prior = [PriorCellInput(barcodes_text="", uses_consumed=0, cell_id=42)]  # remaining=3
    result = pack_cells(_disjoint_samples(3), max_uses=1, objective="fewest", prior_cells=prior)

    prior_cell = next(c for c in result.all_cells if c.prior)
    assert prior_cell.remaining == 3  # physical capacity untouched...
    assert len(prior_cell.uses) == 1  # ...but this batch only planned it to the 1x dial
    # remaining 2 samples each open their own fresh 1-use cell, none reuse the prior again
    assert sorted(len(c.uses) for c in result.cells if not c.prior) == [1, 1]


def test_pack_caps_prior_cell_reuse_at_dial_headroom_above_consumed():
    # A prior cell already used once (uses_consumed=1) under a 2x dial has exactly 1 use
    # of dial headroom left (2 - 1), even though it physically has 2 uses remaining.
    prior = [PriorCellInput(barcodes_text="", uses_consumed=1, cell_id=42)]  # remaining=2
    result = pack_cells(_disjoint_samples(3), max_uses=2, objective="fewest", prior_cells=prior)

    prior_cell = next(c for c in result.all_cells if c.prior)
    assert len(prior_cell.uses) == 1  # capped at max_uses - uses_consumed = 1, not remaining = 2


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


def test_pack_processes_position_constrained_movie_lengths_before_flexible():
    # Same (no) priority, but a position-constrained 12h sample (cell-1-locked) must be
    # processed before a flexible 24h sample so it claims its required well first. max_uses=1
    # -> one fresh cell each, so cell-creation order reveals processing order. Input order is
    # reversed so this only passes if the sort actually reorders by movie-constrainedness.
    samples = [
        ParsedSample(id="S24", barcodes=["b24"], key="S24#0", movie_time=24),
        ParsedSample(id="S12", barcodes=["b12"], key="S12#1", movie_time=12),
    ]
    result = pack_cells(samples, max_uses=1, objective="fewest")
    by_id = {c.id: c.uses[0].id for c in result.cells}
    assert by_id["C1"] == "S12"  # constrained 12h processed ahead of flexible 24h
    assert by_id["C2"] == "S24"


def test_pack_movie_constraint_yields_to_priority():
    # Movie-constrainedness is only a WITHIN-priority tiebreak: a High-priority flexible 24h
    # sample still beats a Standard-priority constrained 12h sample. Priority stays the ruling
    # factor (Priority -> Movie -> Container ID).
    samples = [
        ParsedSample(id="S12", barcodes=["b12"], priority="Standard (3)", key="S12#0", movie_time=12),
        ParsedSample(id="S24", barcodes=["b24"], priority="High (1)", key="S24#1", movie_time=24),
    ]
    result = pack_cells(samples, max_uses=1, objective="fewest")
    by_id = {c.id: c.uses[0].id for c in result.cells}
    assert by_id["C1"] == "S24"  # High priority wins despite being the flexible movie length
    assert by_id["C2"] == "S12"


def test_pack_by_order_schedules_strictly_by_upload_and_csv_sequence():
    # "By Order" ignores priority and the Container-ID/movie ordering entirely and processes
    # samples in ascending DB id - which import_service assigns per row in upload/CSV order.
    # The later-uploaded sample here (higher id) is High priority and its Container ID sorts
    # first, so every other objective would process it first; "order" must still take the
    # earlier-uploaded one (lower id) first. max_uses=1 -> one fresh cell each, so cell-creation
    # order (C1, C2) reveals processing order. Input is reversed so this only passes if the sort
    # actually reorders by id, not by coincidentally preserving input order.
    first_uploaded = ParsedSample(id="ZZZ", barcodes=["bc1"], priority="Standard (3)", key="a", sample_id=1)
    later_uploaded = ParsedSample(id="AAA", barcodes=["bc2"], priority="High (1)", key="b", sample_id=2)
    result = pack_cells([later_uploaded, first_uploaded], max_uses=1, objective="order")
    by_cell = {c.id: c.uses[0].sample_id for c in result.cells}
    assert by_cell["C1"] == 1  # earlier upload first, despite lower priority and earlier-sorting id
    assert by_cell["C2"] == 2


def test_pack_by_order_fills_a_whole_tray_before_reusing_like_utilisation():
    # "By Order" borrows utilisation's cell choice: open cells_per_day distinct fresh cells
    # before any 2nd use, so a day's wells fill with the first uploaded samples in sequence
    # rather than deepening one cell down a single column. 8 samples, cells_per_day=4 -> 4 cells
    # at 2 uses each, and the first tray's 4 cells hold the first 4 uploaded samples' first uses.
    samples = [ParsedSample(id=f"S{i}", barcodes=[f"bc{i}"], key=f"k{i}", sample_id=i) for i in range(1, 9)]
    result = pack_cells(samples, max_uses=3, objective="order", cells_per_day=4)
    assert len(result.cells) == 4
    assert sorted((len(c.uses) for c in result.cells), reverse=True) == [2, 2, 2, 2]
    first_uses = [c.uses[0].sample_id for c in sorted(result.cells, key=lambda c: int(c.id[1:]))]
    assert first_uses == [1, 2, 3, 4]


def test_pack_keeps_a_small_insert_sample_off_a_reusable_prior_cell():
    # A prior cell has capacity and a disjoint barcode, so reuse-before-new would normally
    # place the sample on it - but a small-insert (<= threshold) library must take a FIRST use
    # only, so it opens a fresh cell and leaves the prior cell untouched.
    prior = [PriorCellInput(barcodes_text="bprior", uses_consumed=1, cell_id=42)]  # remaining=2
    samples = [ParsedSample(id="S1", barcodes=["bc1"], key="S1#0", insert_size_bp=3000)]

    result = pack_cells(samples, max_uses=3, objective="fewest", prior_cells=prior)

    prior_cell = next(c for c in result.all_cells if c.prior)
    assert prior_cell.uses == []  # a small-insert sample never reuses
    fresh = next(c for c in result.cells if not c.prior)
    assert [u.id for u in fresh.uses] == ["S1"]  # it opens its own fresh first use


def test_pack_never_stacks_two_small_insert_samples_on_one_cell():
    # Each small-insert sample must be a cell's first use, so two of them can't share a cell
    # even with disjoint barcodes and room to deepen - they open two separate fresh cells.
    samples = [
        ParsedSample(id="S1", barcodes=["bc1"], key="S1#0", insert_size_bp=2000),
        ParsedSample(id="S2", barcodes=["bc2"], key="S2#1", insert_size_bp=4000),
    ]
    result = pack_cells(samples, max_uses=3, objective="fewest")
    assert len(result.cells) == 2
    assert all(len(c.uses) == 1 for c in result.cells)


def test_pack_reuses_normally_for_a_large_insert_sample():
    # A sample above the threshold is unaffected: reuse-before-new still deepens onto the
    # prior cell (a null insert size behaves the same - "not recorded" never counts as small).
    prior = [PriorCellInput(barcodes_text="bprior", uses_consumed=1, cell_id=42)]
    for size in (15000, None):
        samples = [ParsedSample(id="S1", barcodes=["bc1"], key="S1#0", insert_size_bp=size)]
        result = pack_cells(samples, max_uses=3, objective="fewest", prior_cells=list(prior))
        prior_cell = next(c for c in result.all_cells if c.prior)
        assert [u.id for u in prior_cell.uses] == ["S1"], f"insert_size_bp={size}"


def test_pack_small_insert_threshold_is_configurable():
    # Same 4500bp sample: "small" (kept off reuse) under the default 5000 threshold, but
    # "large" (reuses normally) once the admin lowers the threshold to 4000.
    def run(threshold: int):
        prior = [PriorCellInput(barcodes_text="bprior", uses_consumed=1, cell_id=42)]
        samples = [ParsedSample(id="S1", barcodes=["bc1"], key="S1#0", insert_size_bp=4500)]
        return pack_cells(
            samples, max_uses=3, objective="fewest", prior_cells=prior, insert_size_reuse_threshold=threshold
        )

    small = run(5000)
    assert next(c for c in small.all_cells if c.prior).uses == []  # 4500 <= 5000 -> first use only
    large = run(4000)
    assert [u.id for u in next(c for c in large.all_cells if c.prior).uses] == ["S1"]  # 4500 > 4000 -> reuses
