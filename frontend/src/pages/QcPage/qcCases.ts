import type { CellOut } from "@/types/cell";
import type { CreditCaseState } from "@/types/credit";
import type { PacbioCaseOut } from "@/types/pacbioCase";
import {
  acquisitionsToCells,
  acquisitionsToTrays,
  CREDIT_BUCKET_LABEL,
  CREDIT_NEXT_STEP_LABEL,
  type CreditCaseAge,
  creditBucket,
  creditCaseAge,
  cellFailureAt,
  expectedReimbursement,
  formatQuantity,
  getCreditStages,
  localDateOnly,
  triggeringUse,
} from "@/utils/creditCase";
import { runLabel } from "@/utils/runLabel";

/** One row of the QC worklist: a cell's own credit case, or a case logged without a cell. Both
 * carry the same credit stage fields, so they bucket, sort, search and export identically. */
export type QcCase = { kind: "cell"; cell: CellOut } | { kind: "no_cell"; pacbioCase: PacbioCaseOut };

export function qcCaseCredit(item: QcCase): CreditCaseState {
  return item.kind === "cell" ? item.cell : item.pacbioCase;
}

export function qcCaseKey(item: QcCase): string {
  return item.kind === "cell" ? `cell-${item.cell.id}` : `case-${item.pacbioCase.id}`;
}

function ms(iso: string | null): number | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : t;
}

/** When the case happened: a cell's failed (else last) use finishing, else its stop / creation;
 * a no-cell case's occurred-on day. Drives oldest-first ordering and days open. */
export function qcCaseFailureMs(item: QcCase): number | null {
  if (item.kind === "no_cell") return localDateOnly(item.pacbioCase.occurred_on).getTime();
  return ms(cellFailureAt(item.cell) ?? item.cell.created_at);
}

export function qcCaseReceivedMs(item: QcCase): number {
  return ms(qcCaseCredit(item).credit_received_at) ?? 0;
}

/** Acquisitions to claim: computed for a cell (failed + remaining), entered for a no-cell case. */
export function qcCaseExpected(item: QcCase): number | null {
  return item.kind === "cell" ? expectedReimbursement(item.cell) : item.pacbioCase.expected_acquisitions;
}

export function qcCaseAge(item: QcCase, nowMs: number = Date.now()): CreditCaseAge | null {
  return creditCaseAge(qcCaseCredit(item), qcCaseFailureMs(item), nowMs);
}

/** The run / sample / instrument a case is about - the cell's triggering use, or what was typed in. */
function qcCaseContext(item: QcCase): { run: string; sample: string; instrument: string } {
  if (item.kind === "no_cell") {
    const pc = item.pacbioCase;
    return { run: pc.run_name ?? "", sample: pc.pool_id ?? "", instrument: pc.instrument_serial ?? "" };
  }
  const use = triggeringUse(item.cell.uses);
  return {
    run: use ? runLabel({ run_id: use.run_batch_id, run_name: use.run_name }) : "",
    sample: use?.sample_pool_id ?? "",
    instrument: use?.instrument_serial ?? item.cell.current_instrument_serial ?? "",
  };
}

const digits = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");

/** Does a case match the QC search box? Case-insensitive substring over the case number, internal
 * report ID, owner, cell code / summary, run, sample and instrument. A digits-only query also
 * matches a case number ignoring leading zeros and punctuation, since PacBio's own reports print
 * case numbers both as 00316913 and 316913. */
export function qcCaseMatches(item: QcCase, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const credit = qcCaseCredit(item);
  const ctx = qcCaseContext(item);
  const haystack = [
    credit.pacbio_case_number,
    credit.internal_report_id,
    credit.credit_owner,
    item.kind === "cell" ? item.cell.code : item.pacbioCase.summary,
    ctx.run,
    ctx.sample,
    ctx.instrument,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  if (haystack.includes(q)) return true;
  const qDigits = /^\d+$/.test(q) ? digits(q) : "";
  return qDigits !== "" && digits(credit.pacbio_case_number ?? "").includes(qDigits);
}

function isoDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const QC_CSV_HEADERS = [
  "Kind",
  "Case",
  "Owner",
  "PacBio case number",
  "Internal report ID",
  "Stage",
  "Next step",
  "Failure date",
  "Days open",
  "Acquisitions expected",
  "Acquisitions credited",
  "Cells credited",
  "Trays credited",
  "Reported to PacBio",
  "Internal report",
  "Credit confirmed",
  "Credit received",
  "Instrument",
  "Run",
  "Sample",
];

/** One case as a row of the QC export (QC_CSV_HEADERS order). Credited acquisitions are also
 * given as cells and trays (1 cell = 3 acquisitions = 0.25 tray) to tally against PacBio's FOC
 * tracker. Values are raw - the caller csvSafe()s them. */
export function qcCaseCsvRow(item: QcCase, nowMs: number = Date.now()): string[] {
  const credit = qcCaseCredit(item);
  const ctx = qcCaseContext(item);
  const age = qcCaseAge(item, nowMs);
  const expected = qcCaseExpected(item);
  const credited = credit.pacbio_credit_confirmed_at ? credit.credit_acquisitions : null;
  const { currentKey } = getCreditStages(credit);
  const failureMs = qcCaseFailureMs(item);
  return [
    item.kind === "cell" ? "Cell" : "No cell",
    item.kind === "cell" ? item.cell.code : item.pacbioCase.summary,
    credit.credit_owner ?? "",
    credit.pacbio_case_number ?? "",
    credit.internal_report_id ?? "",
    CREDIT_BUCKET_LABEL[creditBucket(credit)],
    currentKey ? CREDIT_NEXT_STEP_LABEL[currentKey] : "Settled",
    failureMs === null ? "" : isoDay(new Date(failureMs).toISOString()),
    age ? String(age.daysOpen) : "",
    expected == null ? "" : String(expected),
    credited == null ? "" : String(credited),
    credited == null ? "" : formatQuantity(acquisitionsToCells(credited)),
    credited == null ? "" : formatQuantity(acquisitionsToTrays(credited)),
    isoDay(credit.pacbio_reported_at),
    isoDay(credit.internal_report_at),
    isoDay(credit.pacbio_credit_confirmed_at),
    isoDay(credit.credit_received_at),
    ctx.instrument,
    ctx.run,
    ctx.sample,
  ];
}
