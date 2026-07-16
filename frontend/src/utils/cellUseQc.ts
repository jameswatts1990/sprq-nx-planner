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
