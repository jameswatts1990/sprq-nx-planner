import type { BadgeTone } from "@/components/ui/Badge";
import type { CellOut } from "@/types/cell";
import type { CellStatus } from "@/types/common";

/** Shared status -> Badge tone/label mapping, used by the Cells page (each tray's cell chips and
 * badges) and CellDetailPage (header) so every view of a cell stays visually consistent. */
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

/** A discard that closed off uses the cell would otherwise still have had - a manual Discard all
 * cells or a grid swap-out. Autoschedule's whole-tray disposal also stamps a discard, but only once
 * every use is spent or booked, so it loses nothing and isn't worth flagging (or restoring). */
export function discardedWithUsesLeft(cell: CellOut): boolean {
  return cell.discarded_at != null && cell.uses_consumed + cell.uses_scheduled_later < cell.max_uses;
}
