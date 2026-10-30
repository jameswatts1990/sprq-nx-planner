import { Link } from "react-router-dom";

import { CreditStageStrip } from "@/components/cells/CreditStageStrip";
import { Badge } from "@/components/ui/Badge";
import type { CellOut } from "@/types/cell";
import {
  cellFailureAt,
  CREDIT_BUCKET_LABEL,
  CREDIT_BUCKET_TONE,
  CREDIT_NEXT_STEP_LABEL,
  CREDIT_OVERDUE_DAYS,
  creditBucket,
  creditCaseAge,
  failUseNumber,
  getCreditStages,
  OVERDUE_BADGE,
  triggeringUse,
} from "@/utils/creditCase";

import styles from "./SlotDetailPopover.module.css";

/** Whether a cell has a PacBio credit case at all - the same gate as the cell page's credit card
 * and the backend's cell_service.in_credit_workflow. */
export function hasCreditCase(cell: CellOut): boolean {
  return cell.has_failed_use || cell.status === "stopped";
}

/** Whether this placement is the one its cell's credit case was raised on (the triggering use) -
 * so a slot popover only shows the claim on the sample that actually failed, not on the cell's
 * other, healthy uses. */
export function isCreditCaseUse(cell: CellOut, cellUseId: number): boolean {
  return hasCreditCase(cell) && triggeringUse(cell.uses)?.id === cellUseId;
}

/**
 * Read-only "QC claim" row for the schedule's cell-stub and slot popovers: the same five-dot stage
 * strip and stage-group badge as the QC worklist, plus case number / next step / age (or credited
 * acquisitions once settled), linking to the cell page where the full tracker and its stage
 * actions live. Caller gates it on hasCreditCase / isCreditCaseUse.
 */
export function CreditClaimRow({ cell, showTrigger = false }: { cell: CellOut; showTrigger?: boolean }) {
  const bucket = creditBucket(cell);
  const { currentKey } = getCreditStages(cell);
  const failureAt = cellFailureAt(cell);
  const age = creditCaseAge(cell, failureAt ? Date.parse(failureAt) : null);
  const credited = cell.pacbio_credit_confirmed_at ? cell.credit_acquisitions : null;
  const trigger = showTrigger ? triggeringUse(cell.uses) : null;
  const triggerUseNumber = showTrigger ? failUseNumber(cell.uses) : null;

  return (
    <div className={`${styles.row} ${styles.claimRow}`}>
      <span className={`detailLabel ${styles.claimLabel}`}>QC claim</span>
      <span className={styles.claimValue}>
        <span className={styles.claimHead}>
          <CreditStageStrip credit={cell} />
          <Badge tone={CREDIT_BUCKET_TONE[bucket]}>{CREDIT_BUCKET_LABEL[bucket]}</Badge>
        </span>
        <span className={styles.claimMeta}>
          {trigger && triggerUseNumber !== null && (
            <span>
              From Use {triggerUseNumber}
              {trigger.sample_pool_id ? ` (${trigger.sample_pool_id})` : ""}
            </span>
          )}
          {cell.pacbio_case_number && <span>Case {cell.pacbio_case_number}</span>}
          {credited != null && <span>{credited} acq credited</span>}
          {currentKey && <span>Next: {CREDIT_NEXT_STEP_LABEL[currentKey]}</span>}
          {age &&
            (age.overdue ? (
              <Badge
                tone={OVERDUE_BADGE.tone}
                title={`No progress for ${age.waitDays} days - over the ${CREDIT_OVERDUE_DAYS}-day limit, so it needs chasing. Open ${age.daysOpen} days in all.`}
              >
                {OVERDUE_BADGE.label} · {age.waitDays} d
              </Badge>
            ) : (
              <span title={`Waiting ${age.waitDays} days for this step`}>{age.daysOpen} d open</span>
            ))}
          <Link to={`/cells/${cell.id}`} className="link">
            Credit tracker →
          </Link>
        </span>
      </span>
    </div>
  );
}
