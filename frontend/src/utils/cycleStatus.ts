import type { BadgeTone } from "@/components/ui/Badge";
import type { CycleStatus } from "@/types/common";

/** Shared status -> Badge tone mapping, used by both the grid and RunDetailPage so the
 * two views stay visually consistent (mirrors utils/cellStatus.ts's pattern). */
export const CYCLE_STATUS_TONE: Record<CycleStatus, BadgeTone> = {
  planned: "default",
  running: "info",
  completed: "success",
  // An aborted run is an instrument/run problem, not a cell fault - amber, matching a cell
  // use aborted (useStatusTone.ts's severity scale), not red.
  aborted: "warning",
};

/** How a run's status reads everywhere it's shown (badges, the grid's lock tag, the Batch Sheet). */
export const RUN_STATUS_LABEL: Record<CycleStatus, string> = {
  planned: "Planned",
  running: "Running",
  completed: "Completed",
  aborted: "Aborted",
};

/** RUN_STATUS_LABEL for a status that arrives as a plain string (the Batch Sheet's runs). */
export function runStatusLabel(status: string): string {
  return RUN_STATUS_LABEL[status as CycleStatus] ?? status;
}
