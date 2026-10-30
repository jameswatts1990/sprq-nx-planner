import type { BadgeTone } from "@/components/ui/Badge";
import type { SampleStatus } from "@/types/common";

/** Shared status -> Badge tone/label mapping for a sample's lifecycle, used by the Sample
 * detail page and the Help tab's Colour & Status Legend so the two stay consistent
 * (mirrors utils/cellStatus.ts's pattern). */
export const SAMPLE_STATUS_TONE: Record<SampleStatus, BadgeTone> = {
  backlog: "default",
  // Grey = waiting (backlog or placed but not started), blue = active, green = done - the same
  // grammar as runs and cell uses. Failed is orange like a failed cell use (a cell-quality loss).
  scheduled: "default",
  in_progress: "info",
  completed: "success",
  failed: "orange",
  cancelled: "default",
};

export const SAMPLE_STATUS_LABEL: Record<SampleStatus, string> = {
  backlog: "Backlog",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};
