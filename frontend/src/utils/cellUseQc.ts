import type { CellUseHistoryOut } from "@/types/cell";

const TERMINAL_QC_STATUSES = new Set(["cancelled", "failed", "aborted", "completed"]);

/** Gates both per-use QC actions (Mark Failed and Mark Aborted) - available as soon as
 * the run is locked, since the instrument commits to a run (and a real-world problem
 * becomes possible) at its scheduled start time, independent of whether anyone has
 * explicitly confirmed it loaded yet (see run_started). Excludes uses that never
 * happened (cancelled) or that already have a recorded outcome (failed/aborted/completed) -
 * re-flagging one of those needs a fresh use, not a second QC action on the same one.
 * Shared by CellDetailPage's Use history table and SlotDetailPopover's grid quick
 * actions so the two stay consistent. */
export function canRecordQcOutcome(use: CellUseHistoryOut): boolean {
  return use.run_started && !TERMINAL_QC_STATUSES.has(use.status);
}

/** Gates the "Undo" action on a Mark Failed/Mark Aborted verdict - only those two are
 * reversible from here. "completed" is never set through this per-use action (only via a
 * cycle's own completion), and "cancelled" (Stop cell's "Blocked" marker) is undone via
 * the Cell's own Undo stop action instead, since it cascades from the whole cell, not one
 * use. Defers entirely to the backend's own `undo_available` flag (cell_service.
 * undo_available) rather than re-deriving it from `status` here - whether the sample has
 * since moved on (requeued or rescheduled) can only be known server-side, and showing a
 * button that's certain to 409 reads to a lab user as "Undo just stopped working". */
export function canUndoQcOutcome(use: CellUseHistoryOut): boolean {
  return use.undo_available;
}
