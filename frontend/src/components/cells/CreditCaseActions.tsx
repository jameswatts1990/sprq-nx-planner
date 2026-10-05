import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { instrumentsApi } from "@/api/instruments";
import { pacbioCasesApi } from "@/api/pacbioCases";
import { settingsApi } from "@/api/settings";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import type { CellDetailOut, CellOut } from "@/types/cell";
import type { CreditCaseState } from "@/types/credit";
import type { InstrumentOut } from "@/types/instrument";
import type { PacbioCaseOut } from "@/types/pacbioCase";
import {
  cellFailureAt,
  expectedReimbursement,
  failUseNumber,
  getCreditStages,
  localDateOnly,
  triggeringUse,
} from "@/utils/creditCase";
import {
  buildCreditEmailContext,
  buildPacbioCaseEmailContext,
  type CreditEmailContext,
  creditEmailMailto,
  DEFAULT_CREDIT_EMAIL,
  renderCreditEmail,
} from "@/utils/creditEmail";
import { plateWellFromPlate } from "@/utils/plateWell";
import { runLabel } from "@/utils/runLabel";

import styles from "./CreditCaseActions.module.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** DD-Mon-YYYY (e.g. 24-Jul-2026) for the exported "Date of Occurrence" column, matching the
 * date format the lab's issue-tracking sheet expects. */
function formatOccurrenceDate(d: Date | null): string {
  if (!d) return "";
  return `${String(d.getDate()).padStart(2, "0")}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

interface ReportField {
  label: string;
  value: string;
}

/** The case-specific inputs to the issue report - derived from a cell's triggering use, or taken
 * from what was typed in for a case logged without a cell. */
interface IssueReportContext {
  occurredOn: Date | null;
  problem: string;
  caseNumber: string | null;
  sampleId: string;
  instrumentSerial: string | null;
}

function cellReportContext(cell: CellDetailOut): IssueReportContext {
  const use = triggeringUse(cell.use_history);
  const well = use ? plateWellFromPlate(use.plate_index, use.well, { qualified: true }) : "";
  const run = use ? runLabel({ run_id: use.run_batch_id, run_name: use.run_name }) : "";
  const failureAt = cellFailureAt(cell);
  // Use number = the triggering use's 1-based position in the (chronological) use history.
  const useIndex = use ? cell.use_history.findIndex((u) => u.id === use.id) : -1;
  const useNo = useIndex === -1 ? "" : `use ${useIndex + 1}`;
  return {
    occurredOn: failureAt ? new Date(failureAt) : null,
    problem: ["Failed Cell", run, well, useNo].filter(Boolean).join(" "),
    caseNumber: cell.pacbio_case_number,
    sampleId: use?.sample_pool_id ?? "",
    instrumentSerial: use?.instrument_serial ?? null,
  };
}

function pacbioCaseReportContext(pc: PacbioCaseOut): IssueReportContext {
  return {
    occurredOn: localDateOnly(pc.occurred_on),
    problem: [pc.summary, pc.run_name].filter(Boolean).join(" – "),
    caseNumber: pc.pacbio_case_number,
    sampleId: pc.pool_id ?? "",
    instrumentSerial: pc.instrument_serial,
  };
}

/** The issue report as an ordered list of {column header, value} pairs, matching the lab's
 * central issue-tracking spreadsheet exactly. Verbatim constants (team, owner, N/A, the notified
 * manager) come straight from the lab's agreed template; the variable fields come from the case
 * context and the instrument's asset/location record. Columns the sheet fills itself (Reported
 * by, Study ID, Make/Model/Serial "auto fill") stay blank. */
function buildReportFields(ctx: IssueReportContext, instrument: InstrumentOut | undefined): ReportField[] {
  return [
    { label: "Date of Occurrence", value: formatOccurrenceDate(ctx.occurredOn) },
    { label: "Reported by (Sanger ID)", value: "" },
    { label: "Team who identified the issue", value: "Long_Read" },
    { label: "Issue Owner", value: "Long_Read" },
    { label: "Project / Product Line", value: "PacBio" },
    { label: "Stage of Process Issue Identified", value: "Sequencing" },
    { label: "Source of Issue", value: "Consumables/Reagents" },
    { label: "Problem Statement", value: ctx.problem },
    { label: "Vendor/RT Support Ticket", value: ctx.caseNumber ?? "" },
    { label: "Equipment Software name (if applicable)", value: "N/A" },
    { label: "Equipment Program (If applicable)", value: "N/A" },
    { label: "Sample ID(s) e.g. Plate or Tube Barcode ID", value: ctx.sampleId },
    { label: "4 digit Study ID(s)", value: "" },
    { label: "Equipment Owner", value: "Long_Read" },
    { label: "Equipment Asset Number", value: instrument?.asset_number ?? "" },
    { label: "Make of Equipment (auto fill)", value: "" },
    { label: "Model of Equipment (auto fill)", value: "" },
    { label: "Serial number (auto fill)", value: "" },
    { label: "Location of equipment", value: instrument?.location ?? "" },
    {
      label:
        'Select appropriate manager or equivalent. Notify using the "right click and comment function" in the selected name cell',
      value: "James Watts",
    },
  ];
}

/** Force a spreadsheet to read a value as text, not a live formula: any field starting with a
 * formula lead-in (= + - @, or a tab/CR) is prefixed with a single quote. Report fields carry
 * user- and instrument-record-controlled values (case number, sample ID, asset/location), so
 * this defeats CSV formula injection when the report is pasted into the lab's tracking sheet. */
function csvSafe(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** One tab-separated row of the report values - tabs land in separate cells when pasted into a
 * spreadsheet, so it appends as a single new row under the sheet's existing column headers. */
function reportRowTsv(fields: ReportField[]): string {
  return fields.map((f) => csvSafe(f.value)).join("\t");
}

/** A standalone CSV (header row + value row) for download - RFC-4180 quoting so commas, quotes,
 * and newlines inside a field (e.g. the manager-notification column) survive intact. */
function reportCsv(fields: ReportField[]): string {
  const esc = (s: string) => `"${csvSafe(s).replace(/"/g, '""')}"`;
  const headers = fields.map((f) => esc(f.label)).join(",");
  const values = fields.map((f) => esc(f.value)).join(",");
  return `${headers}\r\n${values}\r\n`;
}

/** Copy text to the clipboard, falling back to a hidden-textarea + execCommand when the async
 * Clipboard API is unavailable - which it is in production, served over plain HTTP (a non-secure
 * context, where navigator.clipboard is undefined). Returns whether the copy succeeded. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below (e.g. permission denied).
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type ReportResult = "copied" | "copy-failed" | "downloaded";

/** The "Generate report ▾" split action: a small dropdown to either copy the report as a
 * tab-separated row (to append to the tracking sheet) or download it as a CSV file. Either action
 * opens a confirmation popup that also previews every column/value, so the lab can eyeball the
 * report and - if an insecure-context copy silently failed - select and copy the text by hand. */
function GenerateReportMenu({ fields, filename }: { fields: ReportField[]; filename: string }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ReportResult | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function onCopy() {
    setOpen(false);
    const ok = await copyText(reportRowTsv(fields));
    setResult(ok ? "copied" : "copy-failed");
  }

  function onDownload() {
    setOpen(false);
    downloadCsv(filename, reportCsv(fields));
    setResult("downloaded");
  }

  return (
    <div className={styles.menuWrap} ref={wrapRef}>
      <Button variant="ghost" onClick={() => setOpen((v) => !v)} aria-haspopup="true" aria-expanded={open}>
        Generate report ▾
      </Button>
      {open && (
        <div className={styles.menu} role="menu">
          <button type="button" className={styles.menuItem} role="menuitem" onClick={onCopy}>
            Copy to clipboard
          </button>
          <button type="button" className={styles.menuItem} role="menuitem" onClick={onDownload}>
            Download CSV
          </button>
        </div>
      )}
      {result && (
        <Modal onClose={() => setResult(null)} title="Issue report" maxWidth={560}>
          {result === "copied" && (
            <Note tone="good" icon="✓">
              Report copied to your clipboard — paste it as a new row into the issue-tracking sheet.
            </Note>
          )}
          {result === "downloaded" && (
            <Note tone="good" icon="✓">
              CSV downloaded — one header row and one value row, ready to open or import.
            </Note>
          )}
          {result === "copy-failed" && (
            <Note tone="bad" icon="!">
              Couldn&apos;t copy automatically. Select the values below and copy them by hand, or use Download CSV
              instead.
            </Note>
          )}
          <dl className={styles.preview}>
            {fields.map((f) => (
              <div key={f.label} className={styles.previewRow}>
                <dt className={styles.previewLabel}>{f.label}</dt>
                <dd className={styles.previewValue}>{f.value || "—"}</dd>
              </div>
            ))}
          </dl>
          <ModalActions>
            <Button variant="primary" onClick={() => setResult(null)}>
              Close
            </Button>
          </ModalActions>
        </Modal>
      )}
    </div>
  );
}

/** The report + email helpers' inputs. */
interface GeneratorInput {
  report: IssueReportContext;
  email: CreditEmailContext;
  reportFilename: string;
}

interface Generators {
  reportFields: ReportField[];
  reportFilename: string;
  emailHref: string;
}

/** Build the Generate report / Generate email helpers for a case. Instruments carry the asset
 * number and location the report needs (a case only knows the serial); the admin-editable email
 * template falls back to the built-in default while it loads so the button always works. Both
 * queries only run when `input` is given. Cached under the shared ["instruments", false]. */
function useCreditGenerators(input: GeneratorInput | null): Generators | undefined {
  const { data: instruments } = useQuery({
    queryKey: ["instruments", false],
    queryFn: () => instrumentsApi.list(false),
    enabled: !!input,
  });
  const { data: emailTemplate } = useQuery({
    queryKey: ["credit-email-template"],
    queryFn: () => settingsApi.getCreditEmail(),
    enabled: !!input,
  });
  if (!input) return undefined;
  const instrument = instruments?.find((i) => i.serial_number === input.report.instrumentSerial);
  return {
    reportFields: buildReportFields(input.report, instrument),
    reportFilename: input.reportFilename,
    emailHref: creditEmailMailto(renderCreditEmail(emailTemplate ?? DEFAULT_CREDIT_EMAIL, input.email)),
  };
}

/** The five stage mutations a case owner supplies. The cell and no-cell APIs share request shapes,
 * so only the endpoint differs. */
interface CreditCaseOps {
  reportToPacbio: (caseNumber: string) => Promise<unknown>;
  setInternalReport: (reportId: string) => Promise<unknown>;
  confirmCredit: (acquisitions: number) => Promise<unknown>;
  setCreditNotes: (notes: string | null) => Promise<unknown>;
  receiveCredit: () => Promise<unknown>;
}

/** What to claim back, with the hover explanation and the one-line basis under the figure. */
interface Reimbursement {
  amount: number;
  title: string;
  hint: string;
}

interface CreditStageActionsProps {
  credit: CreditCaseState;
  /** Unique per case - scopes the notes field's element id. */
  idKey: string;
  ops: CreditCaseOps;
  /** Refreshes whichever lists show this case after a mutation. */
  onChanged: () => void;
  reimbursement: Reimbursement | null;
  /** Report/email helpers; omitted where their inputs aren't loaded. */
  generators?: Generators;
  compact: boolean;
}

/** The interactive half of a PacBio credit case: the single control for whatever stage the case
 * is at next (report to PacBio → add internal report → confirm → receive), plus the case note.
 * Kind-agnostic - CreditCaseActions (a cell's case) and PacbioCaseActions (a case logged without
 * a cell) wrap it with their own endpoints and helpers, so both kinds act identically. */
function CreditStageActions({
  credit,
  idKey,
  ops,
  onChanged,
  reimbursement,
  generators,
  compact,
}: CreditStageActionsProps) {
  const [caseNumber, setCaseNumber] = useState("");
  const [reportId, setReportId] = useState("");
  const [acquisitions, setAcquisitions] = useState("");
  // Seeded from the case so the editor shows the saved note; re-synced when the persisted
  // value changes (e.g. after a save invalidates and the prop refreshes).
  const [creditNotes, setCreditNotes] = useState(credit.credit_notes ?? "");
  useEffect(() => {
    setCreditNotes(credit.credit_notes ?? "");
  }, [credit.credit_notes]);

  const internalReportMutation = useMutation({
    mutationFn: ops.setInternalReport,
    onSuccess: () => {
      onChanged();
      setReportId("");
    },
  });
  const reportMutation = useMutation({
    mutationFn: ops.reportToPacbio,
    onSuccess: () => {
      onChanged();
      setCaseNumber("");
    },
  });
  const confirmCreditMutation = useMutation({
    mutationFn: ops.confirmCredit,
    onSuccess: () => {
      onChanged();
      setAcquisitions("");
    },
  });
  const creditNotesMutation = useMutation({ mutationFn: ops.setCreditNotes, onSuccess: onChanged });
  const receiveCreditMutation = useMutation({ mutationFn: ops.receiveCredit, onSuccess: onChanged });

  const { currentKey, allDone } = getCreditStages(credit);

  return (
    <div className={compact ? styles.actionsBare : styles.actions}>
      {/* Expected reimbursement: a transparent, at-a-glance figure of what to claim, shown on
          the full tracker while the case is still open. Compact QC rows stay tight — expand a
          row (or read the generated email) to see it. */}
      {!compact && !allDone && reimbursement && (
        <div className={styles.reimburse} title={reimbursement.title}>
          <span className={styles.reimburseLabel}>Expected reimbursement</span>
          <span className={styles.reimburseValue}>
            {reimbursement.amount} acquisition{reimbursement.amount === 1 ? "" : "s"}
          </span>
          <span className={styles.reimburseHint}>{reimbursement.hint}</span>
        </div>
      )}

      {currentKey === "pacbio" && (
        <>
          {!compact && (
            <div className={styles.actionLead}>Raise the case with PacBio, then record the case number they issue.</div>
          )}
          <div className={styles.actionRow}>
            <input
              type="text"
              className={styles.input}
              value={caseNumber}
              onChange={(e) => setCaseNumber(e.target.value)}
              placeholder="Case number, e.g. CS-000123"
              maxLength={64}
            />
            <Button
              variant="primary"
              onClick={() => reportMutation.mutate(caseNumber.trim())}
              disabled={!caseNumber.trim() || reportMutation.isPending}
            >
              {reportMutation.isPending ? "Saving…" : "Add case number"}
            </Button>
            {generators && (
              <a className="btn ghost" href={generators.emailHref}>
                Generate email…
              </a>
            )}
          </div>
        </>
      )}

      {currentKey === "internal" && (
        <>
          {!compact && (
            <div className={styles.actionLead}>
              Raise the internal report (now that you have the PacBio case number), then record its report ID here.
              {generators && " Generate report copies the issue row to your clipboard or downloads it as a CSV."}
            </div>
          )}
          <div className={styles.actionRow}>
            <input
              type="text"
              className={styles.input}
              value={reportId}
              onChange={(e) => setReportId(e.target.value)}
              placeholder="Report ID, e.g. 26_NC_S_004"
              maxLength={64}
            />
            <Button
              variant="primary"
              onClick={() => internalReportMutation.mutate(reportId.trim())}
              disabled={!reportId.trim() || internalReportMutation.isPending}
            >
              {internalReportMutation.isPending ? "Saving…" : "Add report ID"}
            </Button>
            {generators && (
              <GenerateReportMenu fields={generators.reportFields} filename={generators.reportFilename} />
            )}
          </div>
        </>
      )}

      {currentKey === "confirmed" && (
        <>
          {!compact && (
            <div className={styles.actionLead}>
              Record how many acquisitions PacBio confirmed they will credit for this case.
            </div>
          )}
          <div className={styles.actionRow}>
            <input
              type="number"
              min={1}
              step={1}
              className={styles.input}
              value={acquisitions}
              onChange={(e) => setAcquisitions(e.target.value)}
              placeholder={`Acquisitions credited, e.g. ${reimbursement?.amount ?? 1}`}
            />
            <Button
              variant="primary"
              onClick={() => confirmCreditMutation.mutate(Number(acquisitions))}
              disabled={!(Number(acquisitions) >= 1) || confirmCreditMutation.isPending}
            >
              {confirmCreditMutation.isPending ? "Saving…" : "Record credit"}
            </Button>
          </div>
        </>
      )}

      {currentKey === "received" && (
        <div className={styles.actionRow}>
          <Button
            variant="primary"
            onClick={() => receiveCreditMutation.mutate()}
            disabled={receiveCreditMutation.isPending}
          >
            {receiveCreditMutation.isPending ? "Marking…" : "Mark as received in lab"}
          </Button>
        </div>
      )}

      {allDone && (
        <Note tone="good" icon="✓">
          Credit received in lab{credit.pacbio_case_number ? ` — case ${credit.pacbio_case_number}` : ""}
          {credit.credit_acquisitions
            ? ` (${credit.credit_acquisitions} acquisition${credit.credit_acquisitions === 1 ? "" : "s"} credited)`
            : ""}
          . This case is closed.
        </Note>
      )}

      {/* Case notes: editable at any stage from failure through credit received, kept
          across steps. Only on the full tracker - the compact QC rows stay tight; expand a
          row to edit its note. */}
      {!compact && (
        <div className={styles.notesBlock}>
          <label className={styles.notesLabel} htmlFor={`credit-notes-${idKey}`}>
            Case notes
          </label>
          <textarea
            id={`credit-notes-${idKey}`}
            className={styles.notesArea}
            value={creditNotes}
            onChange={(e) => setCreditNotes(e.target.value)}
            placeholder="Add a note about this credit case (optional)…"
            rows={2}
          />
          <div className={styles.actionRow}>
            <Button
              variant="ghost"
              onClick={() => creditNotesMutation.mutate(creditNotes.trim() || null)}
              disabled={creditNotes.trim() === (credit.credit_notes ?? "") || creditNotesMutation.isPending}
            >
              {creditNotesMutation.isPending ? "Saving…" : credit.credit_notes ? "Update note" : "Save note"}
            </Button>
          </div>
        </div>
      )}

      {creditNotesMutation.isError && (
        <Note tone="bad" icon="!">
          {creditNotesMutation.error instanceof ApiError
            ? creditNotesMutation.error.message
            : "Failed to save case note."}
        </Note>
      )}

      {internalReportMutation.isError && (
        <Note tone="bad" icon="!">
          {internalReportMutation.error instanceof ApiError
            ? internalReportMutation.error.message
            : "Failed to save internal report."}
        </Note>
      )}
      {reportMutation.isError && (
        <Note tone="bad" icon="!">
          {reportMutation.error instanceof ApiError ? reportMutation.error.message : "Failed to report to PacBio."}
        </Note>
      )}
      {confirmCreditMutation.isError && (
        <Note tone="bad" icon="!">
          {confirmCreditMutation.error instanceof ApiError
            ? confirmCreditMutation.error.message
            : "Failed to confirm credit."}
        </Note>
      )}
      {receiveCreditMutation.isError && (
        <Note tone="bad" icon="!">
          {receiveCreditMutation.error instanceof ApiError
            ? receiveCreditMutation.error.message
            : "Failed to mark credit received."}
        </Note>
      )}
    </div>
  );
}

/** Plain-language explanation of how the expected reimbursement was derived, shown on hover so
 * the figure is never a mystery number (Transparent: why, at a glance). */
function reimbursementTitle(cell: CellOut, amount: number): string {
  const failNo = failUseNumber(cell.uses);
  const basis = failNo == null ? "" : ` (max ${cell.max_uses} + 1 − use ${failNo} = ${amount})`;
  return (
    `The failed acquisition plus the cell's remaining acquisitions${basis}. ` +
    "Remaining always counts to the cell's max, ignoring any early tray discard."
  );
}

export interface CreditCaseActionsProps {
  cell: CellOut;
  /** Full detail for the triggering cell. Required only to render the report/email generators
   * (they read the use history). Without it the case-number/link inputs and the one-click
   * confirm/receive buttons still work; just the generators are hidden. */
  detail?: CellDetailOut;
  /** Compact layout for the QC worklist rows: drops the recessed panel border and the
   * explanatory lead line so the control sits tight in a list. The tracker card leaves this
   * off, keeping its full look. */
  compact?: boolean;
}

/** A cell's PacBio credit case actions - on the cell detail page's PacbioCreditTracker (with
 * `detail`) and the QC page's worklist rows. Every mutation invalidates the schedule-related
 * query families, so any list showing this cell refreshes itself. */
export function CreditCaseActions({ cell, detail, compact = false }: CreditCaseActionsProps) {
  const queryClient = useQueryClient();
  const ops = useMemo<CreditCaseOps>(
    () => ({
      reportToPacbio: (n) => cellsApi.reportToPacbio(cell.id, { case_number: n }),
      setInternalReport: (id) => cellsApi.setInternalReport(cell.id, { report_id: id }),
      confirmCredit: (count) => cellsApi.confirmCredit(cell.id, { acquisitions: count }),
      setCreditNotes: (notes) => cellsApi.setCreditNotes(cell.id, { notes }),
      receiveCredit: () => cellsApi.receiveCredit(cell.id),
    }),
    [cell.id],
  );
  const generators = useCreditGenerators(
    detail
      ? {
          report: cellReportContext(detail),
          email: buildCreditEmailContext(detail),
          reportFilename: `pacbio-credit-${cell.code}.csv`,
        }
      : null,
  );
  // Expected acquisitions PacBio should credit — the failed acquisition plus the cell's remaining
  // acquisitions, derived from cell.uses/max_uses.
  const amount = expectedReimbursement(cell);

  return (
    <CreditStageActions
      credit={cell}
      idKey={`cell-${cell.id}`}
      ops={ops}
      onChanged={() => invalidateScheduleRelated(queryClient)}
      reimbursement={
        amount == null
          ? null
          : { amount, title: reimbursementTitle(cell, amount), hint: "failed + remaining, to the cell's max" }
      }
      generators={generators}
      compact={compact}
    />
  );
}

/** A credit case logged without a cell - same actions as a cell's case, from the details typed in
 * on the case. Its generators always show (everything they need is on the case itself), and the
 * expected reimbursement is the lab's own estimate rather than a computed figure. */
export function PacbioCaseActions({ pacbioCase, compact = false }: { pacbioCase: PacbioCaseOut; compact?: boolean }) {
  const queryClient = useQueryClient();
  const id = pacbioCase.id;
  const ops = useMemo<CreditCaseOps>(
    () => ({
      reportToPacbio: (n) => pacbioCasesApi.reportToPacbio(id, { case_number: n }),
      setInternalReport: (rid) => pacbioCasesApi.setInternalReport(id, { report_id: rid }),
      confirmCredit: (count) => pacbioCasesApi.confirmCredit(id, { acquisitions: count }),
      setCreditNotes: (notes) => pacbioCasesApi.setCreditNotes(id, { notes }),
      receiveCredit: () => pacbioCasesApi.receiveCredit(id),
    }),
    [id],
  );
  const generators = useCreditGenerators({
    report: pacbioCaseReportContext(pacbioCase),
    email: buildPacbioCaseEmailContext(pacbioCase),
    reportFilename: `pacbio-credit-case-${id}.csv`,
  });
  const amount = pacbioCase.expected_acquisitions;

  return (
    <CreditStageActions
      credit={pacbioCase}
      idKey={`case-${id}`}
      ops={ops}
      onChanged={() => void queryClient.invalidateQueries({ queryKey: ["pacbio-cases"] })}
      reimbursement={
        amount == null
          ? null
          : {
              amount,
              title: "Entered on the case — with no cell linked, the app can't work this out for you.",
              hint: "your estimate, entered on the case",
            }
      }
      generators={generators}
      compact={compact}
    />
  );
}
