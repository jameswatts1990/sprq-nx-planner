import type { CellUseHistoryOut } from "@/types/cell";

/** QC is available as soon as the run is locked - the instrument commits to a run (and a
 * physical cell failure becomes possible) at its scheduled start time, independent of
 * whether anyone has explicitly confirmed it loaded yet (see run_started). Excludes uses
 * that never happened (cancelled) or are already marked Failed. Shared by CellDetailPage's
 * Use history table and SlotDetailPopover's grid quick actions so the two stay consistent. */
export function canMarkFailed(use: CellUseHistoryOut): boolean {
  return use.run_started && use.status !== "cancelled" && use.status !== "failed";
}
