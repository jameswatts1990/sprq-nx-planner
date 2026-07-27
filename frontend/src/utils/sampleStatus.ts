import type { BadgeTone } from "@/components/ui/Badge";
import type { SampleStatus } from "@/types/common";

/** Shared status -> Badge tone/label mapping for a sample's lifecycle, used by the Sample
 * detail page and the Help tab's Colour & Status Legend so the two stay consistent
 * (mirrors utils/cellStatus.ts's pattern). */
export const SAMPLE_STATUS_TONE: Record<SampleStatus, BadgeTone> = {
  backlog: "default",
  scheduled: "info",
  in_progress: "warning",
  completed: "success",
  failed: "danger",
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
