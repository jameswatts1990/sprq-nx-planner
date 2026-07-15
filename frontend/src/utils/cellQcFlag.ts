import type { BadgeTone } from "@/components/ui/Badge";

/** Shared flag -> Badge tone/label mapping for a cell's QC/credit tracking state
 * (CellOut.needs_qc_report / awaiting_credit), used by both CellStatusCard (grid) and
 * the Help tab's Colour & Status Legend so the two stay visually consistent (mirrors
 * utils/cellStatus.ts's pattern). */
export type CellQcFlag = "unreported" | "awaiting_credit";

export const CELL_QC_FLAG_TONE: Record<CellQcFlag, BadgeTone> = {
  unreported: "danger",
  awaiting_credit: "warning",
};

export const CELL_QC_FLAG_LABEL: Record<CellQcFlag, string> = {
  unreported: "Unreported",
  awaiting_credit: "Awaiting credit",
};
