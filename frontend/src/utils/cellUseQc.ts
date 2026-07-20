import type { CellUseHistoryOut } from "@/types/cell";

const TERMINAL_QC_STATUSES = new Set(["cancelled", "failed", "aborted", "completed"]);

/** Gates both per-use QC actions (Mark Failed and Stop cell) - available as soon as the
 * run is locked in ("Confirm loaded" clicked, see run_started), so they always
 * appear/disappear together. Excludes uses that never happened (cancelled) or that
 * already have a recorded outcome (failed/aborted/completed) - re-flagging one of those
 * needs a fresh use, not a second QC action on the same one. Shared by CellDetailPage's
 * Use history table and SlotDetailPopover's grid quick actions so the two stay
 * consistent. */
export function canRecordQcOutcome(use: CellUseHistoryOut): boolean {
  return use.run_started && !TERMINAL_QC_STATUSES.has(use.status);
}

/** Gates the "Undo" action on a Failed verdict - recorded either via Mark Failed or as
 * the triggering use of a Stop cell (see cell_service.stop_cell), both revert the same
 * way here - or an Aborted verdict from a whole-cycle abort (an unrelated code path;
 * the old standalone per-use "Mark Aborted" action has been folded into Stop cell).
 * "completed" is never set through this per-use action (only via a cycle's own
 * completion), and "cancelled" (a later use cancelled by someone else's Stop cell) is
 * undone via the Cell's own Undo stop action instead, since it cascades from the whole
 * cell, not one use. Defers entirely to the backend's own `undo_available` flag
 * (cell_service.undo_available) rather than re-deriving it from `status` here - whether
 * the sample has since moved on (requeued or rescheduled) can only be known
 * server-side, and showing a button that's certain to 409 reads to a lab user as "Undo
 * just stopped working". */
export function canUndoQcOutcome(use: CellUseHistoryOut): boolean {
  return use.undo_available;
}
