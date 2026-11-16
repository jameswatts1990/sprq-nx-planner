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
};
