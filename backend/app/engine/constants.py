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

# A sample's desired movie / acquisition time (h). One of these three (matching the
# per-cell run-time choices); anything missing or out of range falls back to
# DEFAULT_MOVIE_HOURS. Movie time is a per-sample field now (Sample.movie_time_hours) and
# is used as the default run time when a sample is placed manually (see
# placement_service.place_sample). Auto-fill still takes a single run time from its request.
MOVIE_HOURS_CHOICES = (12, 24, 30)
DEFAULT_MOVIE_HOURS = 24

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


# Auto Schedule's movie-time cell-position rule (a lab-workflow constraint layered on top of
# the physical model, not sourced from the PacBio deck): a 12h sample may only load on cell 1
# (carousel position A) and a 30h sample only on cell 4 (position D); a 24h sample has no
# position restriction and may take any cell. Values are within_tray_pos indices
# (0 = cell 1 .. 3 = cell 4). Movie times not listed here (24h, or a missing/None movie time
# that reads as the 24h default) are unrestricted. Only the auto-fill engine applies this -
# a manual drag-drop places a sample wherever the operator drops it. See
# engine/packing.py, engine/slot_scheduling.py and docs/pacbio-sprq-nx-scheduling-reference.md.
MOVIE_CELL_POSITION: dict[int, int] = {12: 0, 30: 3}
ALL_CELL_POSITIONS: frozenset[int] = frozenset(range(CELLS_PER_TRAY))  # {0, 1, 2, 3}


def movie_allowed_positions(movie_hours: int | None) -> frozenset[int]:
    """Which carousel cell positions (within_tray_pos, 0-3) a sample of this movie length may
    load into under Auto Schedule's movie-time rules: 12h -> only cell 1 (pos 0), 30h -> only
    cell 4 (pos 3), everything else (24h, or a missing movie time that defaults to 24h) ->
    every position. Returned as a frozenset so callers can intersect a cell's uses' allowances
    to find the positions still open to a whole (possibly multi-use) cell."""
    pos = MOVIE_CELL_POSITION.get(movie_hours if movie_hours is not None else DEFAULT_MOVIE_HOURS)
    return ALL_CELL_POSITIONS if pos is None else frozenset({pos})
