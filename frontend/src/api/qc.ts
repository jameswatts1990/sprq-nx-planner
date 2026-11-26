import type { QcReview, QcReviewIgnore } from "@/types/qcReview";

import { api } from "./client";

/** The QC worklist's counts (GET /api/qc/summary). awaiting_credit = reported to PacBio, not yet
 * received; total_action = cases needing a report or overdue, each counted once. */
export interface QcSummary {
  needs_report: number;
  awaiting_credit: number;
  overdue: number;
  total_action: number;
}

export const qcApi = {
  summary: () => api.get<QcSummary>("/api/qc/summary"),
  /** The QC Review queue (MLWH). Always resolves: MLWH unset or down is in the body. */
  review: () => api.get<QcReview>("/api/qc/review"),
  ignoreReviewWell: (key: string, reason: string) =>
    api.post<QcReviewIgnore>("/api/qc/review/ignore", { key, reason }),
  restoreReviewWell: (key: string) => api.post<void>("/api/qc/review/restore", { key }),
};
