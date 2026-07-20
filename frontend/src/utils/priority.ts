import type { BadgeTone } from "@/components/ui/Badge";

const PRIORITY_RANK_RE = /\((\d+)\)\s*$/;

/** Priority label a sample is given when a Stop-cell cascade bumps it back to the
 * backlog (see backend's cell_service.stop_cell / engine/packing.ABORTED_PRIORITY) -
 * rank 0 sorts ahead of every other label under the "Label (N)" convention below. */
export const ABORTED_PRIORITY = "Aborted (0)";

/** Lower is higher-priority. Mirrors the backend's _priority_rank() in
 * app/api/samples.py so the badge colour and the table's priority sort stay consistent. */
export function priorityRank(priority: string | null): number {
  if (!priority) return 999;
  const m = PRIORITY_RANK_RE.exec(priority);
  return m ? Number(m[1]) : 999;
}

export function priorityTone(priority: string | null): BadgeTone {
  const rank = priorityRank(priority);
  if (rank <= 1) return "danger";
  if (rank === 2) return "warning";
  return "default";
}
