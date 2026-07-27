import type { BadgeTone } from "@/components/ui/Badge";

const PRIORITY_RANK_RE = /\((\d+)\)\s*$/;

/** Priority label a sample is given when a Stop-cell cascade bumps it back to the
 * backlog (see backend's engine/packing.ABORTED_PRIORITY) - rank 0 sorts ahead of every
 * other label under the "Label (N)" convention below. */
export const ABORTED_PRIORITY = "Aborted (0)";

/** Priority labels for samples a Cell QC action returns to the backlog with a disposition
 * (see backend engine/packing.py). Rank 0, so they sort above "High (1)". The Backlog's
 * "Recoverable Samples" section groups on Sample.qc_disposition, not these strings. */
export const REPEATABLE_PRIORITY = "Repeatable (0)";
export const RECOVERABLE_PRIORITY = "Recoverable (0)";

/** Lower is higher-priority. Mirrors the backend's _priority_rank() in
 * app/api/samples.py so the badge colour and the table's priority sort stay consistent. */
export function priorityRank(priority: string | null): number {
  if (!priority) return 999;
  const m = PRIORITY_RANK_RE.exec(priority);
  return m ? Number(m[1]) : 999;
}

export function priorityTone(priority: string | null): BadgeTone {
  // QC-return labels get their own tones so they read apart from the red Aborted/High:
  // Recoverable (recoverable via re-prep) = blue, Repeatable = orange.
  if (priority?.startsWith("Recoverable")) return "info";
  if (priority?.startsWith("Repeatable")) return "orange";
  const rank = priorityRank(priority);
  if (rank <= 1) return "danger";
  if (rank === 2) return "warning";
  return "default";
}
