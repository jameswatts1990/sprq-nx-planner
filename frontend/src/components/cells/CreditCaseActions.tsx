import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { instrumentsApi } from "@/api/instruments";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import type { CellDetailOut, CellOut } from "@/types/cell";
import type { InstrumentOut } from "@/types/instrument";
import { getCreditStages, triggeringUse } from "@/utils/creditCase";
import { plateWellFromPlate } from "@/utils/plateWell";
import { runLabel } from "@/utils/runLabel";

import styles from "./CreditCaseActions.module.css";

function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** DD-Mon-YYYY (e.g. 24-Jul-2026) for the exported "Date of Occurrence" column, matching the
 * date format the lab's issue-tracking sheet expects. */
function formatOccurrenceDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

interface ReportField {
  label: string;
  value: string;
}

/** The failed-cell issue report as an ordered list of {column header, value} pairs, matching the
 * lab's central issue-tracking spreadsheet exactly. Verbatim constants (team, owner, N/A, the
 * notified manager) come straight from the lab's agreed template; the variable fields are filled
 * from the triggering use, the cell's PacBio case, and the instrument's asset/location record.
 * Columns the sheet fills itself (Reported by, Study ID, Make/Model/Serial "auto fill") stay blank. */
function buildReportFields(cell: CellDetailOut, instrument: InstrumentOut | undefined): ReportField[] {
  const use = triggeringUse(cell.use_history);
  const well = use ? plateWellFromPlate(use.plate_index, use.well, { qualified: true }) : "";
  const run = use ? runLabel({ run_id: use.run_batch_id, run_name: use.run_name }) : "";
  const failureAt = use?.completed_at ?? use?.started_at ?? cell.stopped_at ?? null;
  // Use number = the triggering use's 1-based position in the (chronological) use history.
  const useIndex = use ? cell.use_history.findIndex((u) => u.id === use.id) : -1;
  const useNo = useIndex === -1 ? "" : `use ${useIndex + 1}`;
  const problem = ["Failed Cell", run, well, useNo].filter(Boolean).join(" ");

  return [
    { label: "Date of Occurrence", value: formatOccurrenceDate(failureAt) },
    { label: "Reported by (Sanger ID)", value: "" },
    { label: "Team who identified the issue", value: "Long_Read" },
    { label: "Issue Owner", value: "Long_Read" },
    { label: "Project / Product Line", value: "PacBio" },
    { label: "Stage of Process Issue Identified", value: "Sequencing" },
    { label: "Source of Issue", value: "Consumables/Reagents" },
    { label: "Problem Statement", value: problem },
    { label: "Vendor/RT Support Ticket", value: cell.pacbio_case_number ?? "" },
    { label: "Equipment Software name (if applicable)", value: "N/A" },
    { label: "Equipment Program (If applicable)", value: "N/A" },
    { label: "Sample ID(s) e.g. Plate or Tube Barcode ID", value: use?.sample_external_id ?? "" },
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

/** One tab-separated row of the report values - tabs land in separate cells when pasted into a
 * spreadsheet, so it appends as a single new row under the sheet's existing column headers. */
function reportRowTsv(fields: ReportField[]): string {
  return fields.map((f) => f.value).join("\t");
}

/** A standalone CSV (header row + value row) for download - RFC-4180 quoting so commas, quotes,
 * and newlines inside a field (e.g. the manager-notification column) survive intact. */
function reportCsv(fields: ReportField[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
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
function GenerateReportMenu({ fields, cellCode }: { fields: ReportField[]; cellCode: string }) {
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
    downloadCsv(`pacbio-credit-${cellCode}.csv`, reportCsv(fields));
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

/** PacBio's support desk doesn't know this app's internal tray/well codes (e.g. C02), so the
 * email identifies the cell by the customer sample it ran and the vendor-visible fields (run,
 * instrument serial, date) — never by our well ID. */
function buildCreditEmail(cell: CellDetailOut): { to: string; cc: string; subject: string; body: string } {
  const use = triggeringUse(cell.use_history);
  const sample = use?.sample_external_id || "—";
  const run = use ? runLabel({ run_id: use.run_batch_id, run_name: use.run_name }) : "—";
  const instrument = use?.instrument_serial ?? "—";
  const runDate = use ? formatDateTime(use.started_at ?? use.completed_at) : "—";

  const to = "Pacific Biosciences <support@pacificbiosciences.com>";
  const cc = "Johnathan Smith <jsmith@pacificbiosciences.com>, revio-updates@sanger.ac.uk";
  const subject = `SMRT Cell issue – ${run}`;
  const body = [
    `Cell issue on sample ${sample}, run ${run}, ${instrument}, ${runDate}.`,
    "",
    "Please advise on how to proceed. If the cell will be credited, please can you confirm the number of acquisitions that are being credited.",
    "",
    `Sample ID: ${sample}`,
  ]
    .filter((line): line is string => line !== null)
    // CRLF, not bare LF: Outlook (classic + new) drops or truncates a mailto body
    // whose line breaks are %0A rather than %0D%0A.
    .join("\r\n");

  return { to, cc, subject, body };
}

export interface CreditCaseActionsProps {
  cell: CellOut;
  /** Full detail for the triggering cell. Required only to render the report/email generators
   * (they read the use history + the instrument's asset/location record). Omit it on the QC
   * worklist rows, which carry a CellOut only: the case-number/link inputs and the one-click
   * confirm/receive buttons still work; just the generators are hidden. */
  detail?: CellDetailOut;
  /** Compact layout for the QC worklist rows: drops the recessed panel border and the
   * explanatory lead line so the control sits tight in a list. The tracker card leaves this
   * off, keeping its full look. */
  compact?: boolean;
}

/** The interactive half of a PacBio credit case: the single control for whatever stage the case
 * is at next (report to PacBio → add internal report → confirm → receive). Shared by the cell
 * detail page's PacbioCreditTracker (with `detail`, so the report/email generators show) and the
 * QC page's worklist rows (CellOut only). Every mutation invalidates the schedule-related query
 * families, so any list showing this case refreshes itself. */
export function CreditCaseActions({ cell, detail, compact = false }: CreditCaseActionsProps) {
  const queryClient = useQueryClient();
  const [caseNumber, setCaseNumber] = useState("");
  const [reportId, setReportId] = useState("");
  const [acquisitions, setAcquisitions] = useState("");
  // Seeded from the cell so the editor shows the saved note; re-synced when the persisted
  // value changes (e.g. after a save invalidates and the cell prop refreshes).
  const [creditNotes, setCreditNotes] = useState(cell.credit_notes ?? "");
  useEffect(() => {
    setCreditNotes(cell.credit_notes ?? "");
  }, [cell.credit_notes]);

  const invalidate = () => invalidateScheduleRelated(queryClient);

  // Instruments carry the asset number and location the exported report needs; the use only
  // stores the serial, so map serial -> instrument here. Only needed for the generators, so it's
  // gated on `detail` (the QC rows don't fetch it). Cached under the shared ["instruments", false].
  const { data: instruments } = useQuery({
    queryKey: ["instruments", false],
    queryFn: () => instrumentsApi.list(false),
    enabled: !!detail,
  });

  const internalReportMutation = useMutation({
    mutationFn: (id: string) => cellsApi.setInternalReport(cell.id, { report_id: id }),
    onSuccess: () => {
      invalidate();
      setReportId("");
    },
  });
  const reportMutation = useMutation({
    mutationFn: (caseNum: string) => cellsApi.reportToPacbio(cell.id, { case_number: caseNum }),
    onSuccess: () => {
      invalidate();
      setCaseNumber("");
    },
  });
  const confirmCreditMutation = useMutation({
    mutationFn: (count: number) => cellsApi.confirmCredit(cell.id, { acquisitions: count }),
    onSuccess: () => {
      invalidate();
      setAcquisitions("");
    },
  });
  const creditNotesMutation = useMutation({
    mutationFn: (notes: string) => cellsApi.setCreditNotes(cell.id, { notes: notes || null }),
    onSuccess: invalidate,
  });
  const receiveCreditMutation = useMutation({
    mutationFn: () => cellsApi.receiveCredit(cell.id),
    onSuccess: invalidate,
  });

  const { currentKey, allDone } = getCreditStages(cell);

  const use = detail ? triggeringUse(detail.use_history) : null;
  const instrument = detail ? instruments?.find((i) => i.serial_number === use?.instrument_serial) : undefined;
  const reportFields = detail ? buildReportFields(detail, instrument) : [];
  const email = detail ? buildCreditEmail(detail) : null;
  const emailHref = email
    ? `mailto:${encodeURIComponent(email.to)}?cc=${encodeURIComponent(email.cc)}&subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`
    : "";

  return (
    <div className={compact ? styles.actionsBare : styles.actions}>
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
            />
            <Button
              variant="primary"
              onClick={() => reportMutation.mutate(caseNumber.trim())}
              disabled={!caseNumber.trim() || reportMutation.isPending}
            >
              {reportMutation.isPending ? "Saving…" : "Add case number"}
            </Button>
            {detail && (
              <a className="btn ghost" href={emailHref}>
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
              {detail && " Generate report copies the issue row to your clipboard or downloads it as a CSV."}
            </div>
          )}
          <div className={styles.actionRow}>
            <input
              type="text"
              className={styles.input}
              value={reportId}
              onChange={(e) => setReportId(e.target.value)}
              placeholder="Report ID, e.g. 26_NC_S_004"
            />
            <Button
              variant="primary"
              onClick={() => internalReportMutation.mutate(reportId.trim())}
              disabled={!reportId.trim() || internalReportMutation.isPending}
            >
              {internalReportMutation.isPending ? "Saving…" : "Add report ID"}
            </Button>
            {detail && <GenerateReportMenu fields={reportFields} cellCode={cell.code} />}
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
              className={`${styles.input} ${styles.inputNarrow}`}
              value={acquisitions}
              onChange={(e) => setAcquisitions(e.target.value)}
              placeholder="Acquisitions credited, e.g. 1"
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
          Credit received in lab{cell.pacbio_case_number ? ` — case ${cell.pacbio_case_number}` : ""}
          {cell.credit_acquisitions
            ? ` (${cell.credit_acquisitions} acquisition${cell.credit_acquisitions === 1 ? "" : "s"} credited)`
            : ""}
          . This case is closed.
        </Note>
      )}

      {/* Case notes: editable at any stage from failure through credit received, kept
          across steps. Only on the full tracker - the compact QC rows stay tight; expand a
          row to edit its note. */}
      {!compact && (
        <div className={styles.notesBlock}>
          <label className={styles.notesLabel} htmlFor={`credit-notes-${cell.id}`}>
            Case notes
          </label>
          <textarea
            id={`credit-notes-${cell.id}`}
            className={styles.notesArea}
            value={creditNotes}
            onChange={(e) => setCreditNotes(e.target.value)}
            placeholder="Add a note about this credit case (optional)…"
            rows={2}
          />
          <div className={styles.actionRow}>
            <Button
              variant="ghost"
              onClick={() => creditNotesMutation.mutate(creditNotes.trim())}
              disabled={creditNotes.trim() === (cell.credit_notes ?? "") || creditNotesMutation.isPending}
            >
              {creditNotesMutation.isPending ? "Saving…" : cell.credit_notes ? "Update note" : "Save note"}
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
