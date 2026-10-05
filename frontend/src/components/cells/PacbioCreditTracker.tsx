import type { ReactNode } from "react";

import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import type { CreditCaseState } from "@/types/credit";
import { type CreditStageKey, getCreditStages, localDateOnly } from "@/utils/creditCase";

import styles from "./PacbioCreditTracker.module.css";

function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
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

/** Per-stage display label + icon. The stage keys, order, and done/timestamp derivation live in
 * utils/creditCase (getCreditStages) so this visual track and the QC page's stage strip can't
 * drift apart. */
const STAGE_META: Record<CreditStageKey, { label: string; icon: ReactNode }> = {
  failure: { label: "Failure", icon: <FailureIcon /> },
  pacbio: { label: "PacBio report", icon: <PacbioReportIcon /> },
  internal: { label: "Internal report", icon: <InternalReportIcon /> },
  confirmed: { label: "Credit confirmed", icon: <ConfirmedIcon /> },
  received: { label: "Credit received", icon: <ReceivedIcon /> },
};

export interface PacbioCreditTrackerProps {
  /** A cell's case (CellOut) or a case logged without a cell (PacbioCaseOut). */
  credit: CreditCaseState;
  /** The Failure stage's timestamp - cellFailureAt() for a cell, occurred_on for a no-cell case. */
  failureAt: string | null;
  /** `failureAt` is a YYYY-MM-DD day, not an instant - show it as a date only. */
  failureDateOnly?: boolean;
  /** Optional content between the track and the actions (a no-cell case's typed-in details). */
  children?: ReactNode;
  /** The stage-actions panel: CreditCaseActions (cell) or PacbioCaseActions (no cell). */
  actions: ReactNode;
}

/** Restyles a PacBio credit case as a parcel-tracking-style progress tracker: a row of five
 * connected stage nodes (Failure → PacBio report → Internal report → Credit confirmed → Credit
 * received) above a focused action panel for whichever stage is next. The same card serves a
 * cell's case (cell detail page, QC rows) and a case logged without a cell (QC rows), and the
 * action panels are shared with the QC page's compact rows, so acting anywhere is identical. */
export function PacbioCreditTracker({
  credit,
  failureAt,
  failureDateOnly,
  children,
  actions,
}: PacbioCreditTrackerProps) {
  const { stages, currentIndex, allDone } = getCreditStages(credit, failureAt);
  const stageTime = (key: CreditStageKey, at: string | null) =>
    key === "failure" && failureDateOnly && at ? localDateOnly(at).toLocaleDateString() : formatDateTime(at);

  return (
    <Card>
      <CardHeader badge={allDone ? <Badge tone="success">Credit received</Badge> : <Badge tone="warning">Open</Badge>}>
        <h2>PacBio credit</h2>
      </CardHeader>
      <CardBody>
        <ol className={styles.track}>
          {stages.map((stage, i) => {
            const state = stage.done ? "done" : i === currentIndex ? "current" : "pending";
            const meta = STAGE_META[stage.key];
            return (
              <li
                key={stage.key}
                className={styles.step}
                data-state={state}
                data-linked={i > 0 && stages[i - 1].done ? "on" : "off"}
              >
                <span className={styles.node} aria-hidden="true">
                  {meta.icon}
                </span>
                <span className={styles.stepLabel}>{meta.label}</span>
                <span className={styles.stepTime}>
                  {stage.done ? stageTime(stage.key, stage.at) : state === "current" ? "Next step" : "Pending"}
                </span>
                {stage.key === "internal" && credit.internal_report_id && (
                  <span className={styles.stepMeta}>Report {credit.internal_report_id}</span>
                )}
                {stage.key === "pacbio" && credit.pacbio_case_number && (
                  <span className={styles.stepMeta}>Case {credit.pacbio_case_number}</span>
                )}
                {stage.key === "confirmed" && credit.credit_acquisitions != null && (
                  <span className={styles.stepMeta}>
                    {credit.credit_acquisitions} acquisition{credit.credit_acquisitions === 1 ? "" : "s"} credited
                  </span>
                )}
              </li>
            );
          })}
        </ol>

        {children}
        {actions}
      </CardBody>
    </Card>
  );
}
