import type { BadgeTone } from "@/components/ui/Badge";
import type { CellOut } from "@/types/cell";

/** The PacBio credit workflow stages, in workflow order. "failure" is the always-done entry
 * point (the run that failed / the cell being stopped); the other four are the recovery steps.
 * The order here is the single source of truth shared by PacbioCreditTracker (the visual 5-node
 * track) and the QC page's per-row stage strip. */
export type CreditStageKey = "failure" | "pacbio" | "internal" | "confirmed" | "received";

export interface CreditStageState {
  key: CreditStageKey;
  /** When this stage completed - null while still pending. */
  at: string | null;
  done: boolean;
}

export interface CreditStages {
  stages: CreditStageState[];
  /** Index of the next unfinished stage, or -1 once every stage is done. */
  currentIndex: number;
  /** Key of the next stage to action, or null once the case is fully settled. */
  currentKey: Exclude<CreditStageKey, "failure"> | null;
  allDone: boolean;
}

/** The triggering use of a credit case: the most recent Failed use, or (for a Stopped cell with
 * no Failed use) the most recent use overall. Generic over the use shape so it works with both
 * CellOut.uses (CellUseSummaryOut, the list rows) and CellDetailOut.use_history (the full
 * tracker). */
export function triggeringUse<T extends { status: string }>(uses: T[]): T | null {
  return [...uses].reverse().find((u) => u.status === "failed") ?? uses[uses.length - 1] ?? null;
}

/** Derive the five credit stages purely from a cell's credit timestamps (all present on CellOut,
 * so this works for both the list and detail views). `failureAt` is supplied by the caller - the
 * triggering use's completion time, or the cell's stopped_at - since it's the one stage timestamp
 * not stored directly on the cell; pass null where only progression (done/current) matters. */
export function getCreditStages(cell: CellOut, failureAt: string | null = null): CreditStages {
  const stages: CreditStageState[] = [
    { key: "failure", at: failureAt, done: true },
    { key: "pacbio", at: cell.pacbio_reported_at, done: !!cell.pacbio_reported_at },
    { key: "internal", at: cell.internal_report_at, done: !!cell.internal_report_at },
    { key: "confirmed", at: cell.pacbio_credit_confirmed_at, done: !!cell.pacbio_credit_confirmed_at },
    { key: "received", at: cell.credit_received_at, done: !!cell.credit_received_at },
  ];
  const currentIndex = stages.findIndex((s) => !s.done);
  return {
    stages,
    currentIndex,
    currentKey: currentIndex === -1 ? null : (stages[currentIndex].key as Exclude<CreditStageKey, "failure">),
    allDone: currentIndex === -1,
  };
}

/** Which QC-page stage group a cell sits in. Mutually exclusive and exhaustive over cells in the
 * credit workflow: received wins, then confirmed, then reported (awaiting), else not-yet-reported. */
export type CreditBucket = "needs_report" | "awaiting" | "confirmed" | "received";

export function creditBucket(cell: CellOut): CreditBucket {
  if (cell.credit_received_at) return "received";
  if (cell.pacbio_credit_confirmed_at) return "confirmed";
  if (cell.pacbio_reported_at) return "awaiting";
  return "needs_report";
}

/** The QC worklist groups, in display order. The received group is the collapsed "settled" tail. */
export const CREDIT_BUCKET_ORDER: CreditBucket[] = ["needs_report", "awaiting", "confirmed", "received"];

export const CREDIT_BUCKET_LABEL: Record<CreditBucket, string> = {
  needs_report: "Needs report",
  awaiting: "Awaiting PacBio credit",
  confirmed: "Confirmed — awaiting receipt",
  received: "Received / settled",
};

export const CREDIT_BUCKET_TONE: Record<CreditBucket, BadgeTone> = {
  needs_report: "danger",
  awaiting: "warning",
  confirmed: "info",
  received: "success",
};

/** Short human label for whatever the cell's next credit action is - drives the collapsed QC
 * row's "next step" hint. Keyed by getCreditStages().currentKey. */
export const CREDIT_NEXT_STEP_LABEL: Record<Exclude<CreditStageKey, "failure">, string> = {
  pacbio: "Report to PacBio",
  internal: "Add internal report",
  confirmed: "Record credit",
  received: "Mark received in lab",
};
