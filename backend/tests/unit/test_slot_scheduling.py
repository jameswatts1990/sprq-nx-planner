"""Direct unit tests of fill_slots() - previously untested (only exercised indirectly via
the auto-fill integration tests). Covers the two behaviors this feature added: 8-well
(two-tray) capacity per slot, and the cross-instrument pin filter (cells cannot move
between instruments)."""
from datetime import date

from app.engine.slot_scheduling import fill_slots
from app.engine.types import PackedCell, ParsedSample, SlotInput


def _cell(id_, samples, prior=False, pinned=None):
    return PackedCell(
        id=id_,
        prior=prior,
        prior_barcodes=set(),
        uses_consumed=0,
        remaining=8,
        barcodes=set(),
        uses=samples,
        pinned_instrument_serial=pinned,
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
