"""Constants ported verbatim from revio-nx-planner.html (lines 359-364, 362), except
where noted below for the 8-well/two-tray loading redesign."""

INSTRUMENTS = ["84047", "84098", "84093", "84309"]

# Physical tray size (SMRT Cell tray = 4 cells) - used only for cost/KPI tray-grouping
# (see engine/kpis.py). Distinct from WELLS below, which is the scheduling capacity of
# one run: a run supports up to two trays (8 wells) loaded at once.
CELLS_PER_TRAY = 4
WELLS = ["A01", "B01", "C01", "D01", "A02", "B02", "C02", "D02"]  # tray 1: 0-3, tray 2: 4-7

CELL_LIFETIME_H = 108
# Every multi-use SMRT Cell physically supports up to 3 acquisitions (PacBio technical
# overview p.10, p.25) - this is a fixed instrument fact, not a per-run planning choice.
# See docs/pacbio-sprq-nx-scheduling-reference.md #1.
CELL_MAX_USES = 3
FIRST_PREP_H = 2
REUSE_PREP_H = 0.75

# Hours added to a run's movie_hours to get the total instrument lock window (movie time
# plus turnaround/cleanup before the instrument can start its next run).
LOCK_BUFFER_HOURS = 6

COST_BY_DEPTH = {1: 1480, 2: 888, 3: 690}
SINGLE_USE_PER_ACQ = 995

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

DAY_START_HOUR = 12  # default run start hour when a caller doesn't supply one explicitly
