import type { BadgeTone } from "@/components/ui/Badge";
import type { CellStatus } from "@/types/common";

/** Shared status -> Badge tone/label mapping, used by both CellStatusCard (grid) and
 * CellDetailPage (header) so the two views stay visually consistent. */
export const CELL_STATUS_TONE: Record<CellStatus, BadgeTone> = {
  open: "success",
  // Exhausted is the normal end of a cell's life (every use spent) - grey, not a failure red.
  exhausted: "default",
  window_expired: "danger",
  retired: "warning",
  stopped: "danger",
};

export const CELL_STATUS_LABEL: Record<CellStatus, string> = {
  open: "Open",
  exhausted: "Exhausted",
  window_expired: "Window expired",
  retired: "Retired",
  stopped: "Stopped",
};
