import type { BadgeTone } from "@/components/ui/Badge";
import type { CycleStatus } from "@/types/common";

/** Shared status -> Badge tone mapping, used by both the grid and RunDetailPage so the
 * two views stay visually consistent (mirrors utils/cellStatus.ts's pattern). */
export const CYCLE_STATUS_TONE: Record<CycleStatus, BadgeTone> = {
  planned: "default",
  running: "success",
  completed: "info",
  aborted: "danger",
};
