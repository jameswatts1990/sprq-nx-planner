import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { CreditCaseActions } from "@/components/cells/CreditCaseActions";
import { PacbioCreditTracker } from "@/components/cells/PacbioCreditTracker";
import { Badge } from "@/components/ui/Badge";
import { Note } from "@/components/ui/Note";
import type { CellOut } from "@/types/cell";
import type { CreditCaseState } from "@/types/credit";
import { CELL_STATUS_LABEL, CELL_STATUS_TONE } from "@/utils/cellStatus";
import { cellFailureAt, getCreditStages, triggeringUse } from "@/utils/creditCase";
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

export interface CaseRowFrameProps {
  credit: CreditCaseState;
  /** Identity line after the expand chevron: code/summary, badges, location, date. */
  head: ReactNode;
  /** Context line under it (failed run + sample, or the typed-in run/sample). */
  ctx: ReactNode;
  /** The compact next-step action, shown inline while collapsed. */
  action: ReactNode;
  /** The full tracker, rendered on expand. */
  renderDetail: () => ReactNode;
}

/** The shared shell of one QC worklist row - chevron + identity, context, the mini stage strip
 * with the next action inline, and the full tracker on expand - so a cell's case and a case
 * logged without a cell read and behave the same in the list. */
export function CaseRowFrame({ credit, head, ctx, action, renderDetail }: CaseRowFrameProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.row} data-open={open}>
      <div className={styles.head}>
        <button
          type="button"
          className={styles.expand}
          aria-expanded={open}
          aria-label={open ? "Hide credit tracker" : "Show credit tracker"}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={styles.cx} data-open={open}>
            ▸
          </span>
        </button>
        {head}
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
 * sample, and the next credit action inline (including the Generate email/report helpers). The
 * row fetches the cell's detail so those helpers - which read the use history - work inline; the
 * expanded tracker reuses that same cached query. */
export function CellCaseRow({ cell }: { cell: CellOut }) {
  const backNav = useSampleBackNav();
  const use = triggeringUse(cell.uses);

  const detailQuery = useQuery({ queryKey: ["cell", cell.id], queryFn: () => cellsApi.get(cell.id) });
  const detail = detailQuery.data;

  return (
    <CaseRowFrame
      credit={cell}
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
          <span className={styles.date}>{formatDate(cell.stopped_at ?? cell.last_use_run_date)}</span>
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
      action={<CreditCaseActions cell={cell} detail={detail} compact />}
      renderDetail={() =>
        detailQuery.isLoading ? (
          <span className={styles.detailStatus}>Loading credit tracker…</span>
        ) : detailQuery.isError ? (
          <Note tone="bad" icon="!">
            {detailQuery.error instanceof ApiError ? detailQuery.error.message : "Failed to load the cell."}
          </Note>
        ) : detail ? (
          <PacbioCreditTracker
            credit={detail}
            failureAt={cellFailureAt(detail)}
            actions={<CreditCaseActions cell={detail} detail={detail} />}
          />
        ) : null
      }
    />
  );
}
