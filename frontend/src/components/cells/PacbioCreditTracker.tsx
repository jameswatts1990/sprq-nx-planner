import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { instrumentsApi } from "@/api/instruments";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import type { CellDetailOut } from "@/types/cell";
import type { InstrumentOut } from "@/types/instrument";
import { plateWellFromPlate } from "@/utils/plateWell";
import { runLabel } from "@/utils/runLabel";

import styles from "./PacbioCreditTracker.module.css";

/** The use that triggered the credit case - the most recent Failed use, or (for a Stopped
 * cell with no Failed use) the most recent use overall. Drives the failure date, the
 * PacBio email, and the exported report row so they all describe the same event the lab saw. */
function triggeringUse(cell: CellDetailOut) {
  const uses = cell.use_history;
  return [...uses].reverse().find((u) => u.status === "failed") ?? uses[uses.length - 1] ?? null;
}

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
  const use = triggeringUse(cell);
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

function buildCreditEmail(cell: CellDetailOut): { subject: string; body: string } {
  const use = triggeringUse(cell);
  const well = use ? plateWellFromPlate(use.plate_index, use.well, { qualified: true }) : "—";
  const run = use ? runLabel({ run_id: use.run_batch_id, run_name: use.run_name }) : "—";
  const instrument = use?.instrument_serial ?? "—";
  const runDate = use ? formatDateTime(use.started_at ?? use.completed_at) : "—";

  const subject = `SMRT Cell issue – ${cell.code}`;
  const body = [
    `Cell issue on well ${well}, run ${run}, ${instrument}, ${runDate}.`,
    "",
    "Please advise on how to proceed and if a credit will be given.",
    "",
    `Cell: ${cell.code}`,
    cell.pacbio_case_number ? `Case number: ${cell.pacbio_case_number}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\r\n");

  return { subject, body };
}

// Monochrome, single-weight stroke icons in the app's own style (cf. the scheduler padlock) -
// no icon library is used anywhere in the app, so these are inlined. currentColor lets each
// node tint them by state (done / current / pending).
const iconProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const FailureIcon = () => (
  <svg {...iconProps}>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const InternalReportIcon = () => (
  <svg {...iconProps}>
    <path d="M9 2h6a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" />
    <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
    <line x1="9" y1="12" x2="15" y2="12" />
    <line x1="9" y1="16" x2="13" y2="16" />
  </svg>
);
const PacbioReportIcon = () => (
  <svg {...iconProps}>
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);
const ConfirmedIcon = () => (
  <svg {...iconProps}>
    <path d="M12 2 4 5v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V5l-8-3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);
const ReceivedIcon = () => (
  <svg {...iconProps}>
    <path d="M21 8 12 3 3 8v8l9 5 9-5" />
    <path d="M3 8l9 5 9-5" />
    <path d="M12 13v8" />
    <path d="m8.5 15.5 2 2 4-4" />
  </svg>
);

interface Stage {
  key: string;
  label: string;
  at: string | null;
  done: boolean;
  icon: ReactNode;
}

export interface PacbioCreditTrackerProps {
  cell: CellDetailOut;
}

/** Restyles the PacBio credit case as a parcel-tracking-style progress tracker: a row of
 * five connected stage nodes (Failure → Internal report → PacBio report → Credit confirmed
 * → Credit received) above a focused action panel for whichever stage is next. */
export function PacbioCreditTracker({ cell }: PacbioCreditTrackerProps) {
  const queryClient = useQueryClient();
  const [caseNumber, setCaseNumber] = useState("");
  const [link, setLink] = useState("");

  const invalidate = () => invalidateScheduleRelated(queryClient);

  // Instruments carry the asset number and location the report needs; the use only stores the
  // serial, so map serial -> instrument here. Include inactive ones - a failed cell may sit on an
  // instrument since retired. Cached under the shared ["instruments", false] key.
  const { data: instruments } = useQuery({
    queryKey: ["instruments", false],
    queryFn: () => instrumentsApi.list(false),
  });

  const internalReportMutation = useMutation({
    mutationFn: (url: string) => cellsApi.setInternalReport(cell.id, { link: url }),
    onSuccess: () => {
      invalidate();
      setLink("");
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
    mutationFn: () => cellsApi.confirmCredit(cell.id),
    onSuccess: invalidate,
  });
  const receiveCreditMutation = useMutation({
    mutationFn: () => cellsApi.receiveCredit(cell.id),
    onSuccess: invalidate,
  });

  const use = triggeringUse(cell);
  const failureAt = use?.completed_at ?? use?.started_at ?? cell.stopped_at ?? null;
  const instrument = instruments?.find((i) => i.serial_number === use?.instrument_serial);
  const reportFields = buildReportFields(cell, instrument);

  const stages: Stage[] = [
    { key: "failure", label: "Failure", at: failureAt, done: true, icon: <FailureIcon /> },
    { key: "pacbio", label: "PacBio report", at: cell.pacbio_reported_at, done: !!cell.pacbio_reported_at, icon: <PacbioReportIcon /> },
    { key: "internal", label: "Internal report", at: cell.internal_report_at, done: !!cell.internal_report_at, icon: <InternalReportIcon /> },
    { key: "confirmed", label: "Credit confirmed", at: cell.pacbio_credit_confirmed_at, done: !!cell.pacbio_credit_confirmed_at, icon: <ConfirmedIcon /> },
    { key: "received", label: "Credit received", at: cell.credit_received_at, done: !!cell.credit_received_at, icon: <ReceivedIcon /> },
  ];

  // The next unfinished stage - the one the lab acts on next. -1 once every stage is done.
  const currentIndex = stages.findIndex((s) => !s.done);
  const currentKey = currentIndex === -1 ? null : stages[currentIndex].key;
  const allDone = currentIndex === -1;

  const email = buildCreditEmail(cell);
  const emailHref = `mailto:?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`;

  return (
    <Card>
      <CardHeader badge={allDone ? <Badge tone="success">Credit received</Badge> : <Badge tone="warning">Open</Badge>}>
        <h2>PacBio credit</h2>
      </CardHeader>
      <CardBody>
        <ol className={styles.track}>
          {stages.map((stage, i) => {
            const state = stage.done ? "done" : i === currentIndex ? "current" : "pending";
            return (
              <li
                key={stage.key}
                className={styles.step}
                data-state={state}
                data-linked={i > 0 && stages[i - 1].done ? "on" : "off"}
              >
                <span className={styles.node} aria-hidden="true">
                  {stage.icon}
                </span>
                <span className={styles.stepLabel}>{stage.label}</span>
                <span className={styles.stepTime}>
                  {stage.done ? formatDateTime(stage.at) : state === "current" ? "Next step" : "Pending"}
                </span>
                {stage.key === "internal" && cell.internal_report_link && (
                  <a className={styles.stepMeta} href={cell.internal_report_link} target="_blank" rel="noreferrer">
                    View report
                  </a>
                )}
                {stage.key === "pacbio" && cell.pacbio_case_number && (
                  <span className={styles.stepMeta}>Case {cell.pacbio_case_number}</span>
                )}
              </li>
            );
          })}
        </ol>

        <div className={styles.actions}>
          {currentKey === "internal" && (
            <>
              <div className={styles.actionLead}>
                Raise the internal report (now that you have the PacBio case number), then link it here. Generate report
                copies the issue row to your clipboard or downloads it as a CSV.
              </div>
              <div className={styles.actionRow}>
                <input
                  type="url"
                  className={styles.input}
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="Paste report link (Google Sheet / doc)…"
                />
                <Button
                  variant="primary"
                  onClick={() => internalReportMutation.mutate(link.trim())}
                  disabled={!link.trim() || internalReportMutation.isPending}
                >
                  {internalReportMutation.isPending ? "Saving…" : "Add link"}
                </Button>
                <GenerateReportMenu fields={reportFields} cellCode={cell.code} />
              </div>
            </>
          )}

          {currentKey === "pacbio" && (
            <>
              <div className={styles.actionLead}>Raise the case with PacBio, then record the case number they issue.</div>
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
                <a className="btn ghost" href={emailHref}>
                  Generate email…
                </a>
              </div>
            </>
          )}

          {currentKey === "confirmed" && (
            <div className={styles.actionRow}>
              <Button
                variant="primary"
                onClick={() => confirmCreditMutation.mutate()}
                disabled={confirmCreditMutation.isPending}
              >
                {confirmCreditMutation.isPending ? "Marking…" : "Mark as confirmed"}
              </Button>
              <a className="btn ghost" href={emailHref}>
                Generate email…
              </a>
            </div>
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
              Credit received in lab{cell.pacbio_case_number ? ` — case ${cell.pacbio_case_number}` : ""}. This case is
              closed.
            </Note>
          )}
        </div>

        {internalReportMutation.isError && (
          <Note tone="bad" icon="!">
            {internalReportMutation.error instanceof ApiError
              ? internalReportMutation.error.message
              : "Failed to save internal report link."}
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
      </CardBody>
    </Card>
  );
}
