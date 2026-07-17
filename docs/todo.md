Bugs
Grouped by which part of the app they touch, so related fixes land together instead of one at a time.

Group A: Cell use status & severity (blocking, undo, colour coding)
- Stopping a second or third use of a cell marks the earlier uses as blocked as well. Only the subsequent cells should be blocked
- Undo failed cells has stopped working (abort and stop not tested but please check)
- Aborted, Failed, Stopped cell indicator colours are not consistent in their severity. Aborted should be yellow, failed orange and stopped (and subsequent lost cell uses) red.
  (moved here from Minor Edits - same status subsystem as the two bugs above)
  Note: a broader test run turned up 4 pre-existing, unrelated failures in
  tests/integration/test_cell_qc_and_credit_api.py (Mark Failed/Aborted returning 409
  "Cannot record a QC outcome before this use's run has started" and a bulk-clear-style
  removal test) - worth checking as part of this group, since they're in the same QC/undo
  status area but weren't caused by (or fixed by) the Group B work below.

Group B: Tray population integrity (schedule clear & run lock) - done 2026-07-17
- Clearing the schedule or fully deleting all samples in a tray leaves the cell IDs assigned and therefore the ghost tray's for the reminder of the week. If there are not samples in the tray, there should not be any cell IDs associated with that tray.
- When a run is locked, the unfilled cells loose their population i.e. the cell ID and placeholder graphic disappears. Remember that a cell is physically tied to a tray, so just because it is loaded doesnt mean the cell should disappear.

Group C: Weekly scheduler column layout
- Column sizes in the weekly scheduler seem to vary, can you keep each one fixed at an equal width


Improvements or additions
Grouped the same way - each is fairly independent of the others, so these can be picked up in any order based on priority.

Group D: Run locking UX
- When locking a run, there should be an option to add a name to the run e.g. at Sanger we use the format TRACTION-RUN-1234 - this overrides the current run number

Group E: Help tab overhaul
- Refactor the help section to make it easier for users to find information and read the information - using real life formatting from the app to highlight the relevant areas of the app being discussed. Add a search bar.

Group F: Schedule date navigation
- Make the date selector next/previous a date picker

Minor Edits
(the one item that was here - cell indicator colour severity - has been merged into Group A above, since it's the same status subsystem as those bugs)
