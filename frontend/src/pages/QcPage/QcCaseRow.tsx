import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { CreditCaseActions } from "@/components/cells/CreditCaseActions";
import { PacbioCreditTracker } from "@/components/cells/PacbioCreditTracker";
import { Badge } from "@/components/ui/Badge";
import type { CellOut } from "@/types/cell";
import type { CreditCaseState } from "@/types/credit";
import { CELL_STATUS_LABEL, CELL_STATUS_TONE } from "@/utils/cellStatus";
import {
  type CreditCaseAge,
  CREDIT_OVERDUE_DAYS,
  cellFailureAt,
  getCreditStages,
  OVERDUE_BADGE,
  triggeringUse,
} from "@/utils/creditCase";
import { runLabel } from "@/utils/runLabel";
import { useSampleBackNav } from "@/utils/sampleBackNav";

import styles from "./QcPage.module.css";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

/** Mini five-dot progress strip mirroring the full PacbioCreditTracker, so a case reads the same
 * at a glance in the worklist as it does expanded. */
function MiniStageStrip({ credit }: { credit: CreditCaseState }) {
  const { stages, currentIndex } = getCreditStages(credit);
  return (
    <div
      className={styles.strip}
      title="Failure → PacBio report → Internal report → Credit confirmed → Credit received"
    >
      {stages.map((s, i) => {
        const state = s.done ? "done" : i === currentIndex ? "current" : "pending";
        return <span key={s.key} className={styles.dot} data-state={state} />;
      })}
    </div>
  );
}

/** The at-a-glance facts on the right of a row's head line: PacBio case number, acquisitions
 * (expected until PacBio confirm, then credited), owner, days open - plus an Overdue badge once
 * the current stage has stalled. Missing values read as muted placeholders so a gap is obvious. */
function CaseMeta({ credit, expected, age }: { credit: CreditCaseState; expected: number | null; age: CreditCaseAge | null }) {
  const credited = credit.pacbio_credit_confirmed_at ? credit.credit_acquisitions : null;
  return (
    <>
      {credit.pacbio_case_number ? (
        <span className={styles.metaText}>Case {credit.pacbio_case_number}</span>
      ) : (
        <span className={styles.metaMuted}>No case #</span>
      )}
      {credited != null ? (
        <span className={styles.metaText}>{credited} acq credited</span>
      ) : expected != null ? (
        <span className={styles.metaText}>{expected} acq expected</span>
      ) : null}
      {credit.credit_owner ? (
        <span className={styles.metaText}>{credit.credit_owner}</span>
      ) : (
        <span className={styles.metaMuted}>No owner</span>
      )}
      {age &&
        (age.overdue ? (
          <span
            title={`No progress for ${age.waitDays} days (next: ${age.waitingFor}) - over the ${CREDIT_OVERDUE_DAYS}-day limit, so it needs chasing. Open ${age.daysOpen} days in all.`}
          >
            <Badge tone={OVERDUE_BADGE.tone}>
              {OVERDUE_BADGE.label} · {age.waitDays} d
            </Badge>
          </span>
        ) : (
          <span className={styles.metaText} title={`Waiting ${age.waitDays} days for: ${age.waitingFor}`}>
            {age.daysOpen} d open
          </span>
        ))}
    </>
  );
}

/** Expansion is owned by the QC page (keyed by case), not the row: an action moves a case to
 * another stage group, which remounts its row - a row-local state would snap it shut mid-task. */
export interface RowExpansion {
  open: boolean;
  onToggle: () => void;
}

export interface CaseRowFrameProps extends RowExpansion {
  credit: CreditCaseState;
  /** Identity after the expand chevron: cell code + status + location, or the case summary. */
  head: ReactNode;
  /** Right-aligned failure date. */
  date: string;
  expected: number | null;
  age: CreditCaseAge | null;
  /** Context line under it (failed run + sample, or the typed-in run/sample). */
  ctx: ReactNode;
  /** The compact next-step action, shown inline while collapsed. */
  action: ReactNode;
  /** The full tracker, rendered on expand. */
  renderDetail: () => ReactNode;
}

/** The shared shell of one QC worklist row - chevron + identity + facts, context, the mini stage
 * strip with the next action inline, and the full tracker on expand - so a cell's case and a case
 * logged without a cell read and behave the same in the list. */
export function CaseRowFrame({
  credit,
  head,
  date,
  expected,
  age,
  ctx,
  action,
  renderDetail,
  open,
  onToggle,
}: CaseRowFrameProps) {
  return (
    <div className={styles.row} data-open={open}>
      <div className={styles.head}>
        <button
          type="button"
          className={styles.expand}
          aria-expanded={open}
          aria-label={open ? "Hide credit tracker" : "Show credit tracker"}
          onClick={onToggle}
        >
          <span className={styles.cx} data-open={open}>
            ▸
          </span>
        </button>
        {head}
        <span className={styles.facts}>
          <CaseMeta credit={credit} expected={expected} age={age} />
          <span className={styles.date}>{date}</span>
        </span>
      </div>

      <div className={styles.ctx}>{ctx}</div>

      <div className={styles.progress}>
        <MiniStageStrip credit={credit} />
        {/* Inline next-step action while collapsed; when expanded the full tracker below owns it. */}
        {!open && <div className={styles.action}>{action}</div>}
      </div>

      {open && <div className={styles.detail}>{renderDetail()}</div>}
    </div>
  );
}

/** A cell's credit case in the QC worklist: cell code + status + location, the failed run and
 * sample, and the next credit action inline. Everything - including the Generate email/report
 * helpers and the expanded tracker - comes from the list view's CellOut, so no row fetches the
 * cell's detail. */
export function CellCaseRow({
  cell,
  expected,
  age,
  ...expansion
}: { cell: CellOut; expected: number | null; age: CreditCaseAge | null } & RowExpansion) {
  const backNav = useSampleBackNav();
  const use = triggeringUse(cell.uses);
  const failureAt = cellFailureAt(cell);

  return (
    <CaseRowFrame
      {...expansion}
      credit={cell}
      expected={expected}
      age={age}
      date={formatDate(failureAt ?? cell.last_use_run_date)}
      head={
        <>
          <Link to={`/cells/${cell.id}`} className={styles.code}>
            {cell.code}
          </Link>
          <Badge tone={CELL_STATUS_TONE[cell.status]}>{CELL_STATUS_LABEL[cell.status]}</Badge>
          {cell.current_instrument_serial && (
            <Link
              to={`/cells?instrument=${encodeURIComponent(cell.current_instrument_serial)}&status=all`}
              className={styles.meta}
            >
              {cell.current_instrument_serial}
              {cell.current_well ? ` · ${cell.current_well}` : ""}
            </Link>
          )}
          {cell.tray_id !== null && (
            <Link to={`/cells?tray=${cell.tray_id}`} className={styles.meta}>
              Tray {cell.tray_id}
            </Link>
          )}
        </>
      }
      ctx={
        <>
          {use ? (
            <>
              <span className={styles.ctxLabel}>Failed run</span>
              <Link to={`/history/runs/${use.run_batch_id}`} className="link">
                {runLabel({ run_id: use.run_batch_id, run_name: use.run_name })}
              </Link>
              {use.sample_id !== null && use.sample_pool_id !== null ? (
                <Link to={`/samples/${use.sample_id}`} state={backNav} className="link">
                  {use.sample_pool_id}
                </Link>
              ) : (
                <span className={styles.muted}>no sample</span>
              )}
            </>
          ) : (
            <span className={styles.muted}>No recorded use.</span>
          )}
          {cell.stopped_reason && (
            <span className={styles.reason} title={cell.stopped_reason}>
              · {cell.stopped_reason}
            </span>
          )}
        </>
      }
      action={<CreditCaseActions cell={cell} compact />}
      renderDetail={() => (
        <PacbioCreditTracker credit={cell} failureAt={failureAt} actions={<CreditCaseActions cell={cell} />} />
      )}
    />
  );
}
