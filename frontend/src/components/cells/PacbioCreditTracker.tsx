import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import type { CellDetailOut } from "@/types/cell";
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

/** Short YYYY-MM-DD for the spreadsheet export row - date-only keeps a Google Sheet column tidy. */
function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
    .join("\n");

  return { subject, body };
}

/** A single tab-separated row for pasting straight into a Google Sheet (tabs land in
 * separate cells). Column order matches the Help tab so the sheet header can mirror it. */
function buildReportRow(cell: CellDetailOut): string {
  const use = triggeringUse(cell);
  const well = use ? plateWellFromPlate(use.plate_index, use.well, { qualified: true }) : "";
  const run = use ? runLabel({ run_id: use.run_batch_id, run_name: use.run_name }) : "";
  const failureAt = use?.completed_at ?? use?.started_at ?? cell.stopped_at ?? null;
  return [
    cell.code,
    cell.pacbio_case_number ?? "",
    well,
    run,
    use?.instrument_serial ?? "",
    formatDate(failureAt),
    cell.internal_report_link ?? "",
    formatDate(cell.pacbio_reported_at),
    formatDate(cell.pacbio_credit_confirmed_at),
    formatDate(cell.credit_received_at),
  ].join("\t");
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
  const [copied, setCopied] = useState(false);

  const invalidate = () => invalidateScheduleRelated(queryClient);

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

  const stages: Stage[] = [
    { key: "failure", label: "Failure", at: failureAt, done: true, icon: <FailureIcon /> },
    { key: "internal", label: "Internal report", at: cell.internal_report_at, done: !!cell.internal_report_at, icon: <InternalReportIcon /> },
    { key: "pacbio", label: "PacBio report", at: cell.pacbio_reported_at, done: !!cell.pacbio_reported_at, icon: <PacbioReportIcon /> },
    { key: "confirmed", label: "Credit confirmed", at: cell.pacbio_credit_confirmed_at, done: !!cell.pacbio_credit_confirmed_at, icon: <ConfirmedIcon /> },
    { key: "received", label: "Credit received", at: cell.credit_received_at, done: !!cell.credit_received_at, icon: <ReceivedIcon /> },
  ];

  // The next unfinished stage - the one the lab acts on next. -1 once every stage is done.
  const currentIndex = stages.findIndex((s) => !s.done);
  const currentKey = currentIndex === -1 ? null : stages[currentIndex].key;
  const allDone = currentIndex === -1;

  const email = buildCreditEmail(cell);
  const emailHref = `mailto:?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`;

  function copyReportRow() {
    void navigator.clipboard.writeText(buildReportRow(cell)).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

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
              <div className={styles.actionLead}>Raise the internal report, then link it here.</div>
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
                <Button variant="ghost" onClick={copyReportRow}>
                  {copied ? "Copied ✓" : "Generate report row"}
                </Button>
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
