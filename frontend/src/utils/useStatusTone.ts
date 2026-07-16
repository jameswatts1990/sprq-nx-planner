import type { BadgeTone } from "@/components/ui/Badge";

/** Shared status -> Badge tone mapping for a cell use (a single acquisition of a
 * cell), used by both CellDetailPage's use-history table and the Help tab's
 * Colour & Status Legend so the two stay visually consistent (mirrors
 * utils/cellStatus.ts's and utils/cycleStatus.ts's pattern).
 *
 * Keyed as `Record<string, BadgeTone>` (not the narrower CellUseStatus) because
 * CellDetailOut's use-history status field comes back as a plain string. */
export const USE_STATUS_TONE: Record<string, BadgeTone> = {
  planned: "default",
  started: "info",
  completed: "success",
  failed: "danger",
  aborted: "warning",
  cancelled: "warning",
};
