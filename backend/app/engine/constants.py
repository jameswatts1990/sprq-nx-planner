"""Constants ported verbatim from revio-nx-planner.html (lines 359-364, 362), except
where noted below for the 8-well/two-tray loading redesign."""

INSTRUMENTS = ["84047", "84098", "84093", "84309"]

WELLS = ["A01", "B01", "C01", "D01", "A02", "B02", "C02", "D02"]  # tray 1: 0-3, tray 2: 4-7

CELL_LIFETIME_H = 108
# Every multi-use SMRT Cell physically supports up to 3 acquisitions (PacBio technical
# overview p.10, p.25) - this is a fixed instrument fact, not a per-run planning choice.
# See docs/pacbio-sprq-nx-scheduling-reference.md #1.
CELL_MAX_USES = 3
# SMRT Cells ship in a physical tray of 4 - see cell_service.open_new_tray() and
# models/cell_tray.py::CellTray. Distinct from WELLS' own "tray 1/tray 2" grid-loading
# split below (instrument deck position, not a SMRT Cell shipping tray).
CELLS_PER_TRAY = 4
FIRST_PREP_H = 2
REUSE_PREP_H = 0.75

# Hours added to a run's movie_hours to get the total instrument lock window (movie time
# plus turnaround/cleanup before the instrument can start its next run).
LOCK_BUFFER_HOURS = 6

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

DAY_START_HOUR = 12  # default run start hour when a caller doesn't supply one explicitly


def within_tray_pos(well: str) -> int:
    """The A/B/C/D position (0-3) of a well within its 4-well tray box - a cell keeps this
    fixed position for life, so a reuse into Plate 2 legitimately lands the same letter (e.g.
    A01 on a nominal-A02 grid slot). Single definition so the interactive path
    (placement_service._within_tray_pos) and the serializer (run_serializer._slot_index) can't
    derive it via two different constants that only coincidentally both equal 4: the SMRT-Cell
    shipping-tray size (CELLS_PER_TRAY) and the deck-half size (PLATE_SIZE = len(WELLS)//2). If
    WELLS ever changes so those diverge, this is the one place to reconcile them."""
    return WELLS.index(well) % CELLS_PER_TRAY if well in WELLS else 0
