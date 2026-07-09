"""Constants ported verbatim from revio-nx-planner.html (lines 359-364, 362)."""

INSTRUMENTS = ["84047", "84098", "84093", "84309"]

STAGES_PER_MACHINE = 4
WELLS = ["A01", "B01", "C01", "D01"]

CELL_LIFETIME_H = 108
FIRST_PREP_H = 2
REUSE_PREP_H = 0.75

COST_BY_DEPTH = {1: 1480, 2: 888, 3: 690}
SINGLE_USE_PER_ACQ = 995

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

DAY_START_HOUR = 9  # t0 in the prototype's scheduleCells
