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
  status area but weren't caused by (or fixed by) the tray-population-integrity fixes
  above.



Group C: Weekly scheduler column layout - DONE
- Column sizes in the weekly scheduler seem to vary, can you keep each one fixed at an equal width
  Fixed: the grid table now uses `table-layout: fixed` with an explicit `<colgroup>`
  (SchedulerGrid.tsx/.module.css) so every weekday column renders at the same width
  (268px) regardless of whether a day's cell holds one tray or two; weekend columns stay
  at their own fixed 38px. Previously `table-layout: auto` let a single two-tray cell
  widen its entire column relative to the others. Verified in-browser: all 5 weekday
  headers measure exactly 268px whether or not that column has any two-tray cells.


Improvements or additions
Grouped the same way - each is fairly independent of the others, so these can be picked up in any order based on priority.

Group D: Run locking UX
- When locking a run, there should be an option to add a name to the run e.g. at Sanger we use the format TRACTION-RUN-1234 - this overrides the current run number

Group E: Help tab overhaul
- Refactor the help section to make it easier for users to find information and read the information - using real life formatting from the app to highlight the relevant areas of the app being discussed. Add a search bar.

Group F: Schedule date navigation - DONE
- Make the date selector next/previous a date picker
  Fixed: added a native date-picker input next to Prev/Next/Today in the Schedule
  toolbar (SchedulePage.tsx, plus a new `goToDate` on useSchedulerWindow.ts). Picking
  any date jumps straight to the Mon-Fri week containing it - snapping to that week's
  Monday the same way Today already snaps to the current week - instead of paging
  through every week in between. Prev/Next/Today are unchanged; Help tab's Schedule
  section updated to describe it. Verified in-browser: picking a date 5 weeks out
  jumped the grid straight to that week.

Minor Edits
(the one item that was here - cell indicator colour severity - has been merged into Group A above, since it's the same status subsystem as those bugs)
