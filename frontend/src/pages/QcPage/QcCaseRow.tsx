import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { CreditCaseActions } from "@/components/cells/CreditCaseActions";
import { PacbioCreditTracker } from "@/components/cells/PacbioCreditTracker";
import { Badge } from "@/components/ui/Badge";
import { Note } from "@/components/ui/Note";
import type { CellOut } from "@/types/cell";
import { CELL_STATUS_LABEL, CELL_STATUS_TONE } from "@/utils/cellStatus";
import { type CreditStageState, getCreditStages, triggeringUse } from "@/utils/creditCase";
import { runLabel } from "@/utils/runLabel";
import { useSampleBackNav } from "@/utils/sampleBackNav";

import styles from "./QcPage.module.css";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

/** Mini five-dot progress strip mirroring the cell detail page's PacbioCreditTracker, so a case
 * reads the same at a glance in the worklist as it does on the cell page. */
function MiniStageStrip({ stages, currentIndex }: { stages: CreditStageState[]; currentIndex: number }) {
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

/** One credit case in the QC worklist: a compact identity + failed-run/sample line + mini stage
 * strip with the next credit action inline, expandable to the full PacbioCreditTracker. Works off
 * a CellOut (the list payload); the full tracker fetches the cell's detail only when expanded. */
export function QcCaseRow({ cell }: { cell: CellOut }) {
  const [open, setOpen] = useState(false);
  const backNav = useSampleBackNav();
  const { stages, currentIndex } = getCreditStages(cell);
  const use = triggeringUse(cell.uses);
  const failureDate = formatDate(cell.stopped_at ?? cell.last_use_run_date);

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
        <span className={styles.date}>{failureDate}</span>
      </div>

      <div className={styles.ctx}>
        {use ? (
          <>
            <span className={styles.ctxLabel}>Failed run</span>
            <Link to={`/history/runs/${use.run_batch_id}`} className="link">
              {runLabel({ run_id: use.run_batch_id, run_name: use.run_name })}
            </Link>
            {use.sample_id !== null && use.sample_external_id !== null ? (
              <Link to={`/samples/${use.sample_id}`} state={backNav} className="link">
                {use.sample_external_id}
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
      </div>

      <div className={styles.progress}>
        <MiniStageStrip stages={stages} currentIndex={currentIndex} />
        {/* Inline next-step action while collapsed; when expanded the full tracker below owns it. */}
        {!open && (
          <div className={styles.action}>
            <CreditCaseActions cell={cell} compact />
          </div>
        )}
      </div>

      {open && <QcCaseDetail cellId={cell.id} />}
    </div>
  );
}

/** The expanded region: the full PacBio credit tracker for this cell, fetched on demand (the
 * worklist itself only carries CellOut, but the tracker's report/email generators need detail). */
function QcCaseDetail({ cellId }: { cellId: number }) {
  const query = useQuery({ queryKey: ["cell", cellId], queryFn: () => cellsApi.get(cellId) });

  if (query.isLoading) return <div className={styles.detailStatus}>Loading credit tracker…</div>;
  if (query.isError) {
    return (
      <div className={styles.detail}>
        <Note tone="bad" icon="!">
          {query.error instanceof ApiError ? query.error.message : "Failed to load the cell."}
        </Note>
      </div>
    );
  }
  if (!query.data) return null;

  return (
    <div className={styles.detail}>
      <PacbioCreditTracker cell={query.data} />
    </div>
  );
}
