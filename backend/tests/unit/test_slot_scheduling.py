"""Direct unit tests of fill_slots() - previously untested (only exercised indirectly via
the auto-fill integration tests). Covers the two behaviors this feature added: 8-well
(two-tray) capacity per slot, and the cross-instrument pin filter (cells cannot move
between instruments)."""
from datetime import date

from app.engine.slot_scheduling import fill_slots
from app.engine.types import PackedCell, ParsedSample, SlotInput


def _cell(id_, samples, prior=False, pinned=None, pinned_well=None, tray_id=None):
    return PackedCell(
        id=id_,
        prior=prior,
        prior_barcodes=set(),
        uses_consumed=0,
        remaining=8,
        barcodes=set(),
        uses=samples,
        pinned_instrument_serial=pinned,
        pinned_well=pinned_well,
        tray_id=tray_id,
    )


def _samples(n, prefix="S"):
    return [ParsedSample(id=f"{prefix}{i}", barcodes=[f"bc{prefix}{i}"], key=f"{prefix}{i}#0") for i in range(n)]


def _msample(id_, movie):
    """A single sample carrying a specific movie time (drives the 12h/30h cell rule)."""
    return ParsedSample(id=id_, barcodes=[f"bc{id_}"], key=f"{id_}#0", movie_time=movie)


def _one_use_cells(n):
    # A single physical cell can only run once per calendar day, so filling all 8 wells
    # of one slot in one day takes 8 distinct cells (e.g. 8 fresh cells, or several prior
    # cells each contributing one well) - never one cell reused 8x on the same day.
    return [_cell(f"C{i}", [ParsedSample(id=f"S{i}", barcodes=[f"bcS{i}"], key=f"S{i}#0")]) for i in range(n)]


def test_fill_slots_fills_all_eight_wells_of_one_slot():
    cells = _one_use_cells(8)
    slot = SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20))

    result = fill_slots(cells, [slot])

    assert len(result.assignments) == 8
    assert {a.well for a in result.assignments} == {
        "A01", "B01", "C01", "D01", "A02", "B02", "C02", "D02"
    }
    assert result.unplaced == []
    assert result.filled_slots == [slot]


def test_fill_slots_leaves_extra_samples_unplaced_once_eight_wells_are_full():
    cells = _one_use_cells(9)
    slot = SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20))

    result = fill_slots(cells, [slot])

    assert len(result.assignments) == 8
    assert len(result.unplaced) == 1


def test_fill_slots_caps_wells_to_tray_one_when_cells_per_day_is_four():
    cells = _one_use_cells(8)
    slot = SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20))

    result = fill_slots(cells, [slot], cells_per_day=4)

    assert len(result.assignments) == 4
    assert {a.well for a in result.assignments} == {"A01", "B01", "C01", "D01"}
    assert len(result.unplaced) == 4


def test_fill_slots_loads_a_plate2_box_cell_into_the_plate1_display_well_at_cells_per_day_4():
    """The Stage-1 fix: a reusable cell whose home well is in the Plate-2 box (A02-D02) must be
    loadable into a Plate-1 display well at its own tray position when a 1-plate run offers only
    A01-D01 - a cell is pinned to its tray POSITION, not a plate box. Before the fix this placed
    0 (the cell was skipped for every slot); now A02 loads into A01 (same position 0)."""
    cell = _cell("P1", _samples(1), prior=True, pinned="84047", pinned_well="A02", tray_id=1)
    slot = SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20))

    result = fill_slots([cell], [slot], cells_per_day=4)

    assert len(result.assignments) == 1
    assert result.assignments[0].well == "A01"  # loaded into Plate 1 at the same tray position


def test_fill_slots_loads_a_plate2_box_cell_at_cell_4_into_d01_at_cells_per_day_4():
    """Position is preserved on the cross-box fallback: a D02 (cell 4 / position 3) home cell
    loads into D01, never a different position - locks the letter mapping."""
    cell = _cell("P1", _samples(1), prior=True, pinned="84047", pinned_well="D02", tray_id=1)
    slot = SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20))

    result = fill_slots([cell], [slot], cells_per_day=4)

    assert len(result.assignments) == 1
    assert result.assignments[0].well == "D01"


def test_fill_slots_keeps_one_tray_per_plate_when_two_reuse_trays_could_fall_into_one_box():
    """Tray cohesion: when two different physical trays' cells both need the single Plate-1 box
    of a 1-plate run, only ONE tray backs that plate - the other is left unplaced (it would go to
    a later day), never mixed into the same sample plate. Here tray 1 (positions 0,1) claims the
    plate; tray 2 (positions 2,3) is excluded rather than filling C01/D01 alongside it."""
    t1 = [
        _cell("P1", _samples(1, "A"), prior=True, pinned="84047", pinned_well="A02", tray_id=1),
        _cell("P2", _samples(1, "B"), prior=True, pinned="84047", pinned_well="B02", tray_id=1),
    ]
    t2 = [
        _cell("P3", _samples(1, "C"), prior=True, pinned="84047", pinned_well="C02", tray_id=2),
        _cell("P4", _samples(1, "D"), prior=True, pinned="84047", pinned_well="D02", tray_id=2),
    ]
    slot = SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20))

    result = fill_slots([*t1, *t2], [slot], cells_per_day=4)

    assert len(result.assignments) == 2
    assert {a.cell.tray_id for a in result.assignments} == {1}  # one tray per plate, never mixed
    assert len(result.unplaced) == 2


def test_fill_slots_respects_cross_instrument_pin_when_a_compatible_slot_exists():
    cell = _cell("P1", _samples(2), prior=True, pinned="84047")
    matching = SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20))
    other = SlotInput(instrument_serial="84098", run_date=date(2026, 7, 21))

    result = fill_slots([cell], [matching, other])

    # sample 0 takes the matching-instrument slot; sample 1 can't reuse that same day
    # (strictly-later-date rule) and the only later slot is the wrong instrument (pin) -
    # so it's left unplaced rather than crossing instruments.
    assert len(result.assignments) == 1
    assert all(a.instrument_serial == "84047" for a in result.assignments)
    assert len(result.unplaced) == 1


def test_fill_slots_strands_pinned_cell_when_only_a_different_instrument_slot_is_offered():
    cell = _cell("P1", _samples(1), prior=True, pinned="84047")
    other = SlotInput(instrument_serial="84098", run_date=date(2026, 7, 20))

    result = fill_slots([cell], [other])

    assert result.assignments == []
    assert [s.id for s in result.unplaced] == ["S0"]


def test_fill_slots_unpinned_cell_can_use_any_offered_instrument():
    cell = _cell("C1", _samples(1))  # pinned=None: no prior use anywhere yet
    slot = SlotInput(instrument_serial="84098", run_date=date(2026, 7, 20))

    result = fill_slots([cell], [slot])

    assert len(result.assignments) == 1
    assert result.assignments[0].instrument_serial == "84098"


def test_fill_slots_pins_a_fresh_cell_to_its_first_assigned_instrument():
    """Regression test for a real reported bug: a brand-new cell (no prior use, so
    pinned=None) needing 3 uses, offered slots on 3 different instruments across 3
    different days. Before the fix, pinned_instrument_serial was never set once a fresh
    cell's first use was placed, so each of its uses was independently free to land on
    any offered instrument - the auto-scheduler put a single physical cell's uses on
    three different instruments. Only the first (earliest, alphabetically-first)
    instrument should ever get used; the other two uses must come back unplaced rather
    than crossing instruments."""
    cell = _cell("C1", _samples(3))
    slots = [
        SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20)),  # Mon
        SlotInput(instrument_serial="84098", run_date=date(2026, 7, 22)),  # Wed
        SlotInput(instrument_serial="84309", run_date=date(2026, 7, 23)),  # Thu
    ]

    result = fill_slots([cell], slots)

    assert len(result.assignments) == 1
    assert result.assignments[0].instrument_serial == "84047"
    assert result.assignments[0].run_date == date(2026, 7, 20)
    assert [s.id for s in result.unplaced] == ["S1", "S2"]


def test_fill_slots_reused_cell_prefers_its_own_pinned_well_when_offered():
    """A physically reused cell lands back in its own home well when that well is on offer -
    it never drifts to whichever well happens to be free first (a cell keeps its tray
    POSITION for life). It may load into a *different plate box* at the same position only
    when its home well isn't offered (see the cross-box test below); here C01 is offered, so
    it must take C01."""
    cell = _cell("P1", _samples(1), prior=True, pinned="84047", pinned_well="C01")
    slot = SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20))

    result = fill_slots([cell], [slot])

    assert len(result.assignments) == 1
    assert result.assignments[0].well == "C01"


def test_fill_slots_strands_a_second_same_position_cell_when_no_offered_well_is_free():
    """Two cells from different trays share tray position A (home well A01). In a 1-plate run
    (cells_per_day=4) only ONE position-A well is offered (A01), so once the first takes it the
    second has nowhere to go at its own position and is stranded - never relocated to a
    different position, and never mixed into the same plate as the first cell's tray. (In a
    2-plate run the second would legitimately take A02 - a different plate/tray - see
    test_fill_slots_two_same_position_cells_split_across_plates.)"""
    pinned_cell = _cell("P1", _samples(1), prior=True, pinned="84047", pinned_well="A01", tray_id=1)
    other_pinned = _cell("P2", _samples(1), prior=True, pinned="84047", pinned_well="A01", tray_id=2)
    slot = SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20))

    result = fill_slots([pinned_cell, other_pinned], [slot], cells_per_day=4)

    assert len(result.assignments) == 1
    assert result.assignments[0].well == "A01"
    assert len(result.unplaced) == 1


def test_fill_slots_two_same_position_cells_split_across_plates():
    """The 2-plate counterpart: two different trays' position-A cells both place, in different
    plate boxes (A01 and A02) - a cell is pinned to its tray position, not to a plate box, so
    the second isn't stranded when a second sample plate is on offer."""
    p1 = _cell("P1", _samples(1), prior=True, pinned="84047", pinned_well="A01", tray_id=1)
    p2 = _cell("P2", _samples(1), prior=True, pinned="84047", pinned_well="A01", tray_id=2)
    slot = SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20))

    result = fill_slots([p1, p2], [slot], cells_per_day=8)

    assert len(result.assignments) == 2
    assert {a.well for a in result.assignments} == {"A01", "A02"}
    assert len(result.unplaced) == 0


def test_fill_slots_pins_a_fresh_cell_to_its_first_assigned_well():
    """A brand-new cell (pinned_well=None) needing 2 uses across 2 days must have both
    uses land in the exact same well - the well its first use happened to take, not
    whichever well is next-free on the later day."""
    cell = _cell("C1", _samples(2))
    slots = [
        SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20)),
        SlotInput(instrument_serial="84047", run_date=date(2026, 7, 22)),
    ]

    result = fill_slots([cell], slots)

    assert len(result.assignments) == 2
    wells = {a.well for a in result.assignments}
    assert len(wells) == 1  # same well both times


def test_fill_slots_never_hands_a_vacated_well_to_a_different_fresh_cell():
    """Regression test for a real reported bug: auto-scheduling one instrument across a
    full working week with cells_per_day=4 (tray 1 only) put 5 uses on one physical
    cell - one more than the hard 3-use cap. Cause: two independently-capped fresh
    PackedCells (C1, only 2 uses this batch out of its real 3-use lifetime capacity;
    C2, needing 2 more once C1 stopped being placed) both landed in well A01 - C1 on
    Mon/Tue, then C2 on Thu/Fri once A01 showed "free" again in that day's free_wells
    list (reset per-day). C1's own batch-assigned work being done does NOT mean it's
    physically exhausted (it still has 1 real use of remaining capacity - pack_cells
    just didn't have a 3rd compatible sample to give it this batch), so its well must
    stay reserved for it indefinitely (it may get reused in a *later*, separate Auto
    Schedule call) - C2 must go elsewhere or come back unplaced, never reuse A01."""
    c1 = _cell("C1", _samples(2, prefix="A"))
    c1.total_uses = 2  # matches pack_cells: uses_consumed(0) + future_uses(2) - not exhausted
    c2 = _cell("C2", _samples(2, prefix="B"))
    c2.total_uses = 2
    week = [
        SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20)),  # Mon
        SlotInput(instrument_serial="84047", run_date=date(2026, 7, 21)),  # Tue
        SlotInput(instrument_serial="84047", run_date=date(2026, 7, 22)),  # Wed
        SlotInput(instrument_serial="84047", run_date=date(2026, 7, 23)),  # Thu
        SlotInput(instrument_serial="84047", run_date=date(2026, 7, 24)),  # Fri
    ]
    # Cap this to a single well (cells_per_day=1) so C1 and C2 are forced to compete for
    # the exact same well instead of just spreading across tray 1's other 3 wells.
    result = fill_slots([c1, c2], week, cells_per_day=1)

    wells_by_cell: dict[str, set[str]] = {}
    for a in result.assignments:
        wells_by_cell.setdefault(a.cell.id, set()).add(a.well)

    # C1 gets its 2 uses in well A01; C2 must never be handed that same well once C1
    # has claimed it, even after C1's own batch-assigned work is done - it comes back
    # unplaced instead (there's only one well on offer, and it's still C1's).
    assert wells_by_cell.get("C1") == {"A01"}
    assert "C2" not in wells_by_cell
    assert [s.id for s in result.unplaced] == ["B0", "B1"]


def test_fill_slots_reloads_a_genuinely_exhausted_well_with_a_new_cell():
    """Companion to the regression above: once a cell's total lifetime capacity is
    truly spent (hit the hard 3-use cap, not just "done with this batch's work"), its
    well legitimately becomes available to a brand-new physical cell later in the same
    batch - loading a new tray once the old one is terminal is explicitly legitimate
    (see cell_service.open_new_tray's "a box whose every cell has gone terminal is not
    a collision" rule). Without this, fixing the overuse bug above would over-correct
    into never reloading a genuinely spent cell within one Auto Schedule click."""
    c1 = _cell("C1", _samples(3, prefix="A"))
    c1.total_uses = 3  # matches pack_cells: uses_consumed(0) + future_uses(3) - fully exhausted
    c2 = _cell("C2", _samples(2, prefix="B"))
    c2.total_uses = 2
    week = [
        SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20)),  # Mon
        SlotInput(instrument_serial="84047", run_date=date(2026, 7, 21)),  # Tue
        SlotInput(instrument_serial="84047", run_date=date(2026, 7, 22)),  # Wed
        SlotInput(instrument_serial="84047", run_date=date(2026, 7, 23)),  # Thu
        SlotInput(instrument_serial="84047", run_date=date(2026, 7, 24)),  # Fri
    ]
    result = fill_slots([c1, c2], week, cells_per_day=1)

    wells_by_cell: dict[str, set[str]] = {}
    for a in result.assignments:
        wells_by_cell.setdefault(a.cell.id, set()).add(a.well)

    # C1 uses up well A01 Mon-Wed (its full 3-use cap); once it's genuinely done, C2
    # legitimately takes over the same well for Thu/Fri - nothing is stranded.
    assert wells_by_cell.get("C1") == {"A01"}
    assert wells_by_cell.get("C2") == {"A01"}
    assert result.unplaced == []


def test_fill_slots_confines_a_12h_cell_to_cell_1():
    """A 12h sample may only load on cell 1 - the A-column carousel position (A01/A02)."""
    cell = _cell("C1", [_msample("S12", 12)])
    slot = SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20))

    result = fill_slots([cell], [slot])

    assert len(result.assignments) == 1
    assert result.assignments[0].well == "A01"


def test_fill_slots_confines_a_30h_cell_to_cell_4():
    """A 30h sample may only load on cell 4 - the D-column carousel position (D01/D02)."""
    cell = _cell("C1", [_msample("S30", 30)])
    slot = SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20))

    result = fill_slots([cell], [slot])

    assert len(result.assignments) == 1
    assert result.assignments[0].well == "D01"


def test_fill_slots_places_a_12h_cell_before_a_24h_cell_claims_cell_1():
    """"Restriction only": a 24h cell may use cell 1, but a 12h cell can use ONLY cell 1, so
    the constrained cell is placed first and gets A01 - the 24h cell yields to it and falls to
    the next free position, rather than stranding the 12h sample. Order of the input list must
    not matter (24h listed first here on purpose)."""
    twenty_four = _cell("C24", [_msample("S24", 24)])
    twelve = _cell("C12", [_msample("S12", 12)])
    slot = SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20))

    result = fill_slots([twenty_four, twelve], [slot])

    by_cell = {a.cell.id: a.well for a in result.assignments}
    assert by_cell["C12"] == "A01"
    assert by_cell["C24"] != "A01"
    assert len(result.assignments) == 2


def test_fill_slots_strands_a_second_12h_cell_when_cell_1_is_taken():
    """Only one cell-1 position exists per tray (cells_per_day=4 -> tray 1 only, so just A01).
    Two 12h cells can't both load that day; the second is left unplaced rather than pushed to
    a forbidden well."""
    a = _cell("A", [_msample("SA", 12)])
    b = _cell("B", [_msample("SB", 12)])
    slot = SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20))

    result = fill_slots([a, b], [slot], cells_per_day=4)

    assert len(result.assignments) == 1
    assert result.assignments[0].well == "A01"
    assert len(result.unplaced) == 1


def test_fill_slots_full_mixed_tray_lands_each_movie_time_on_its_cell():
    """The natural full tray: a 12h on cell 1, two 24h on cells 2 & 3, a 30h on cell 4."""
    cells = [
        _cell("C12", [_msample("S12", 12)]),
        _cell("C24a", [_msample("S24a", 24)]),
        _cell("C24b", [_msample("S24b", 24)]),
        _cell("C30", [_msample("S30", 30)]),
    ]
    slot = SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20))

    result = fill_slots(cells, [slot], cells_per_day=4)

    by_cell = {a.cell.id: a.well for a in result.assignments}
    assert by_cell["C12"] == "A01"  # cell 1
    assert by_cell["C30"] == "D01"  # cell 4
    assert by_cell["C24a"] in {"B01", "C01"}
    assert by_cell["C24b"] in {"B01", "C01"}
    assert by_cell["C24a"] != by_cell["C24b"]
    assert result.unplaced == []


def test_fill_slots_fresh_cell_reuses_stay_on_first_instrument_when_available():
    """Companion to the pin-on-first-placement test above: when the pinned instrument
    genuinely does have later capacity, reuse must land there rather than being stranded
    - the fix should confine the cell to one instrument, not merely block other
    instruments outright."""
    cell = _cell("C1", _samples(2))
    slots = [
        SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20)),  # Mon, inst A
        SlotInput(instrument_serial="84098", run_date=date(2026, 7, 21)),  # Tue, inst B (wrong)
        SlotInput(instrument_serial="84047", run_date=date(2026, 7, 22)),  # Wed, inst A again
    ]

    result = fill_slots([cell], slots)

    assert len(result.assignments) == 2
    assert {a.instrument_serial for a in result.assignments} == {"84047"}
    assert sorted(a.run_date for a in result.assignments) == [date(2026, 7, 20), date(2026, 7, 22)]
    assert result.unplaced == []
