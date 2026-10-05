import type { CellOut } from "@/types/cell";
import type { CreditCaseState } from "@/types/credit";
import type { PacbioCaseOut } from "@/types/pacbioCase";
import { localDateOnly } from "@/utils/creditCase";

/** One row of the QC worklist: a cell's own credit case, or a case logged without a cell. Both
 * carry the same credit stage fields, so they bucket, sort and act identically. */
export type QcCase = { kind: "cell"; cell: CellOut } | { kind: "no_cell"; pacbioCase: PacbioCaseOut };

export function qcCaseCredit(item: QcCase): CreditCaseState {
  return item.kind === "cell" ? item.cell : item.pacbioCase;
}

export function qcCaseKey(item: QcCase): string {
  return item.kind === "cell" ? `cell-${item.cell.id}` : `case-${item.pacbioCase.id}`;
}

function ms(iso: string | null): number {
  const t = iso ? Date.parse(iso) : 0;
  return Number.isNaN(t) ? 0 : t;
}

/** When a case "happened", for ordering open groups oldest-first (the oldest open case is the one
 * most in need of chasing): a cell's stop time, else its last run's date, else when it was
 * created; a no-cell case's occurred-on day. */
export function qcCaseAgeMs(item: QcCase): number {
  if (item.kind === "no_cell") return localDateOnly(item.pacbioCase.occurred_on).getTime();
  const c = item.cell;
  return ms(c.stopped_at ?? c.last_use_run_date ?? c.created_at);
}

export function qcCaseReceivedMs(item: QcCase): number {
  return ms(qcCaseCredit(item).credit_received_at);
}
