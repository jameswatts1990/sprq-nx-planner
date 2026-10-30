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
