Bugs
Grouped by which part of the app they touch, so related fixes land together instead of one at a time.

Group A: Cell use status & severity (blocking, undo, colour coding) - DONE
- Stopping a second or third use of a cell marks the earlier uses as blocked as well. Only the subsequent cells should be blocked
  Fixed: SchedulerSlotView's qcAlert derivation was painting the whole-cell "stopped"
  ring over every use of that cell, including earlier uses that already have their own
  recorded outcome. A use's own status (cancelled/failed/aborted) now always wins over
  the cell-level "stopped" flag; "stopped" is only shown as a fallback for a use with no
  outcome of its own yet (still planned/started) - i.e. the one actually cut short.
- Undo failed cells has stopped working (abort and stop not tested but please check)
  Fixed: the button wasn't actually broken - it was correctly refusing to undo once the
  sample had since been requeued/rescheduled (see undo_cell_use_status's drift guard),
  but stayed visible right up until the click, so it read as "stopped working". Added a
  server-computed `undo_available` flag to CellUseHistoryOut (cell_service.py) that
  mirrors that same guard, and `canUndoQcOutcome` (cellUseQc.ts) now defers to it - the
  Undo Failed/Undo Aborted button now disappears once undo would be refused, instead of
  offering an action guaranteed to 409. Also fixed 4 pre-existing, unrelated failures in
  tests/integration/test_cell_qc_and_credit_api.py while verifying this group (3 tests
  placed on a future weekday then tried to record a QC outcome immediately, tripping the
  separate "run hasn't started" gate; 1 bulk-clear test indexed stages[0] from every
  placement response, which is always the same well once 4 placements share one cycle).
- Aborted, Failed, Stopped cell indicator colours are not consistent in their severity. Aborted should be yellow, failed orange and stopped (and subsequent lost cell uses) red.
  (moved here from Minor Edits - same status subsystem as the two bugs above)
  Fixed: added a new `--orange` token/Badge tone distinct from the existing amber/red,
  and rewired the severity scale end-to-end (grid ring + qcAlert label + use-history
  Badge, one shared source of truth in each layer) - Aborted stays amber/yellow
  (mildest), Failed is now orange (its own `.qcAlertFailed` class, one step more severe),
  and Stopped plus the cancelled/"Blocked" marker (a future use lost when the cell was
  stopped) both moved to red, since both mean the physical cell is permanently done. Help
  tab's Schedule/Cells/Legend sections updated to match.



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
