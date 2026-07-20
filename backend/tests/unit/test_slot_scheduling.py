"""Direct unit tests of fill_slots() - previously untested (only exercised indirectly via
the auto-fill integration tests). Covers the two behaviors this feature added: 8-well
(two-tray) capacity per slot, and the cross-instrument pin filter (cells cannot move
between instruments)."""
from datetime import date

from app.engine.slot_scheduling import fill_slots
from app.engine.types import PackedCell, ParsedSample, SlotInput


def _cell(id_, samples, prior=False, pinned=None, pinned_well=None):
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
    )


def _samples(n, prefix="S"):
    return [ParsedSample(id=f"{prefix}{i}", barcodes=[f"bc{prefix}{i}"], key=f"{prefix}{i}#0") for i in range(n)]


def _one_use_cells(n):
    # A single physical cell can only run once per calendar day, so filling all 8 wells
    # of one slot in one day takes 8 distinct cells (e.g. 8 fresh cells, or several prior
    # cells each contributing one well) - never one cell reused 8x on the same day.
    return [_cell(f"C{i}", [ParsedSample(id=f"S{i}", barcodes=[f"bcS{i}"], key=f"S{i}#0")]) for i in range(n)]


def test_fill_slots_fills_all_eight_wells_of_one_slot():
    cells = _one_use_cells(8)
    slot = SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20))

    result = fill_slots(cells, [slot], run_time_hours=24)

    assert len(result.assignments) == 8
    assert {a.well for a in result.assignments} == {
        "A01", "B01", "C01", "D01", "A02", "B02", "C02", "D02"
    }
    assert result.unplaced == []
    assert result.filled_slots == [slot]


def test_fill_slots_leaves_extra_samples_unplaced_once_eight_wells_are_full():
    cells = _one_use_cells(9)
    slot = SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20))

    result = fill_slots(cells, [slot], run_time_hours=24)

    assert len(result.assignments) == 8
    assert len(result.unplaced) == 1


def test_fill_slots_caps_wells_to_tray_one_when_cells_per_day_is_four():
    cells = _one_use_cells(8)
    slot = SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20))

    result = fill_slots(cells, [slot], run_time_hours=24, cells_per_day=4)

    assert len(result.assignments) == 4
    assert {a.well for a in result.assignments} == {"A01", "B01", "C01", "D01"}
    assert len(result.unplaced) == 4


def test_fill_slots_respects_cross_instrument_pin_when_a_compatible_slot_exists():
    cell = _cell("P1", _samples(2), prior=True, pinned="84047")
    matching = SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20))
    other = SlotInput(instrument_serial="84098", run_date=date(2026, 7, 21))

    result = fill_slots([cell], [matching, other], run_time_hours=24)

    # sample 0 takes the matching-instrument slot; sample 1 can't reuse that same day
    # (strictly-later-date rule) and the only later slot is the wrong instrument (pin) -
    # so it's left unplaced rather than crossing instruments.
    assert len(result.assignments) == 1
    assert all(a.instrument_serial == "84047" for a in result.assignments)
    assert len(result.unplaced) == 1


def test_fill_slots_strands_pinned_cell_when_only_a_different_instrument_slot_is_offered():
    cell = _cell("P1", _samples(1), prior=True, pinned="84047")
    other = SlotInput(instrument_serial="84098", run_date=date(2026, 7, 20))

    result = fill_slots([cell], [other], run_time_hours=24)

    assert result.assignments == []
    assert [s.id for s in result.unplaced] == ["S0"]


def test_fill_slots_unpinned_cell_can_use_any_offered_instrument():
    cell = _cell("C1", _samples(1))  # pinned=None: no prior use anywhere yet
    slot = SlotInput(instrument_serial="84098", run_date=date(2026, 7, 20))

    result = fill_slots([cell], [slot], run_time_hours=24)

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

    result = fill_slots([cell], slots, run_time_hours=24)

    assert len(result.assignments) == 1
    assert result.assignments[0].instrument_serial == "84047"
    assert result.assignments[0].run_date == date(2026, 7, 20)
    assert [s.id for s in result.unplaced] == ["S1", "S2"]


def test_fill_slots_reused_cell_only_takes_its_own_pinned_well():
    """Regression test for a real reported bug: a physically reused cell must always
    land back in the exact well it's pinned to (its tray's home_well), never whichever
    well happens to be free first that day - a cell can't move within its own tray."""
    cell = _cell("P1", _samples(1), prior=True, pinned="84047", pinned_well="C01")
    slot = SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20))

    result = fill_slots([cell], [slot], run_time_hours=24)

    assert len(result.assignments) == 1
    assert result.assignments[0].well == "C01"


def test_fill_slots_strands_pinned_cell_when_its_well_is_taken():
    """Companion to the well-pin test above: if another cell has already claimed the
    pinned well for this slot, the pinned cell must be skipped for that slot (and left
    unplaced, or placed on a later day) rather than relocated to a different well."""
    pinned_cell = _cell("P1", _samples(1), prior=True, pinned="84047", pinned_well="A01")
    # This unrelated fresh cell is unpinned, so it's free to take any well - it happens
    # to land on A01 first purely because ordered_cells sorts prior cells first, so give
    # the pinned cell a higher future_uses (irrelevant here) and instead just occupy A01
    # via a second prior cell already pinned there.
    other_pinned = _cell("P2", _samples(1), prior=True, pinned="84047", pinned_well="A01")
    slot = SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20))

    result = fill_slots([pinned_cell, other_pinned], [slot], run_time_hours=24)

    # Only one of the two same-well-pinned cells can be placed this slot; the other is
    # stranded rather than silently relocated to a different well.
    assert len(result.assignments) == 1
    assert result.assignments[0].well == "A01"
    assert len(result.unplaced) == 1


def test_fill_slots_pins_a_fresh_cell_to_its_first_assigned_well():
    """A brand-new cell (pinned_well=None) needing 2 uses across 2 days must have both
    uses land in the exact same well - the well its first use happened to take, not
    whichever well is next-free on the later day."""
    cell = _cell("C1", _samples(2))
    slots = [
        SlotInput(instrument_serial="84047", run_date=date(2026, 7, 20)),
        SlotInput(instrument_serial="84047", run_date=date(2026, 7, 22)),
    ]

    result = fill_slots([cell], slots, run_time_hours=24)

    assert len(result.assignments) == 2
    wells = {a.well for a in result.assignments}
    assert len(wells) == 1  # same well both times


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

    result = fill_slots([cell], slots, run_time_hours=24)

    assert len(result.assignments) == 2
    assert {a.instrument_serial for a in result.assignments} == {"84047"}
    assert sorted(a.run_date for a in result.assignments) == [date(2026, 7, 20), date(2026, 7, 22)]
    assert result.unplaced == []
