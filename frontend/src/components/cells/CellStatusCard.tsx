import { memo } from "react";
import { Link } from "react-router-dom";

import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Badge } from "@/components/ui/Badge";
import type { CellOut, CellUseSummaryOut } from "@/types/cell";
import { CELL_QC_FLAG_LABEL, CELL_QC_FLAG_TONE } from "@/utils/cellQcFlag";
import { CELL_STATUS_LABEL, CELL_STATUS_TONE } from "@/utils/cellStatus";
import { runLabel } from "@/utils/runLabel";
import { useSampleBackNav } from "@/utils/sampleBackNav";
import { USE_STATUS_TONE } from "@/utils/useStatusTone";

import { CellFoilStub } from "./CellFoilStub";
import { CellLifeGantt } from "./CellLifeGantt";
import styles from "./CellStatusCard.module.css";
import { UseBox } from "./UseBox";
import { WindowRing } from "./WindowRing";

export interface CellStatusCardProps {
  cell: CellOut;
  /** When true the detail panel is shown in-flow (the Cells page's "Expand all" toggle).
   * Otherwise the panel is hidden and drops as a floating popover on hover/focus of THIS card
   * alone, so revealing one card never resizes its neighbours or shifts the trays below. */
  expanded?: boolean;
}

/** Terminally done cells have no meaningful live 108h countdown - the ring shows a neutral
 * idle face for these instead of a misleading "hours left". */
const IDLE_STATUSES = new Set(["exhausted", "retired", "stopped"]);

interface RunGroup {
  runBatchId: number;
  runName: string | null;
  items: { use: CellUseSummaryOut; useNo: number }[];
}

/** Group a cell's chronological uses by run, keeping first-appearance (chronological) order,
 * so a long run name owns its own header line and the sample(s) it carried nest beneath it -
 * rather than each row trying to fit "run + sample" on one line and wrapping. */
function groupByRun(uses: CellUseSummaryOut[]): RunGroup[] {
  const order: number[] = [];
  const map = new Map<number, RunGroup>();
  uses.forEach((use, i) => {
    let g = map.get(use.run_batch_id);
    if (!g) {
      g = { runBatchId: use.run_batch_id, runName: use.run_name, items: [] };
      map.set(use.run_batch_id, g);
      order.push(use.run_batch_id);
    }
    g.items.push({ use, useNo: i + 1 });
  });
  return order.map((id) => map.get(id)!);
}

/**
 * Live-cell card backed by CellOut. The 108h window is a ring gauge (WindowRing); the physical
 * cell + its current use read off a holographic foil stub on the right edge (CellFoilStub);
 * the reuse history is a per-cell life timeline (CellLifeGantt) plus a run-grouped sample list.
 * Detail is hidden by default and revealed per-card on hover/focus (or all at once via the
 * page's Expand-all toggle). Memoized so a grid of ~100 cards doesn't all re-render on an
 * unrelated CellsPage state change - each re-renders only when its own cell or `expanded` flips.
 */
export const CellStatusCard = memo(function CellStatusCard({ cell, expanded = false }: CellStatusCardProps) {
  const backNav = useSampleBackNav();
  const qcFlag = cell.needs_qc_report ? "unreported" : cell.awaiting_credit ? "awaiting_credit" : null;

  const idle = IDLE_STATUSES.has(cell.status);
  const ringHours = idle ? null : cell.window_hours_elapsed;
  const idleCenter = cell.status === "exhausted" ? "used" : "—";
  const idleSub =
    cell.status === "exhausted"
      ? `${cell.uses_consumed} / ${cell.max_uses}`
      : cell.status === "retired"
        ? "retired"
        : cell.status === "stopped"
          ? "stopped"
          : "no run";

  const runGroups = groupByRun(cell.uses);

  return (
    <article className={`${styles.card} ${expanded ? styles.expanded : ""}`}>
      <div className={styles.top}>
        <WindowRing hoursElapsed={ringHours} idleCenter={idleCenter} idleSub={idleSub} />
        <div className={styles.meta}>
          <Link to={`/cells/${cell.id}`} className={styles.code}>
            {cell.code}
          </Link>
          <Badge tone={CELL_STATUS_TONE[cell.status]}>{CELL_STATUS_LABEL[cell.status]}</Badge>
          {cell.tray_reuse_disabled && <Badge tone="warning">Reuse skipped</Badge>}
          <span className={styles.uses}>
            {cell.uses_consumed} / {cell.max_uses} uses
            <span className={styles.hint}>
              <span className={styles.cx}>▸</span>details
            </span>
          </span>
        </div>
        <CellFoilStub
          trayPosition={cell.tray_position}
          homeWell={cell.current_well}
          useNumber={cell.uses_consumed}
          trayId={cell.tray_id}
          seedId={cell.id}
        />
      </div>

      <div className={styles.det}>
        <div className={styles.inner}>
          {cell.current_instrument_serial && (
            <div className={styles.row}>
              <span>Instrument</span>
              <Link to={`/cells?instrument=${encodeURIComponent(cell.current_instrument_serial)}&status=all`}>
                {cell.current_instrument_serial}
                {cell.current_well ? ` · ${cell.current_well}` : ""}
              </Link>
            </div>
          )}
          {cell.tray_id !== null && (
            <div className={styles.row}>
              <span>Tray</span>
              <Link to={`/cells?tray=${cell.tray_id}`}>
                Tray {cell.tray_id}
                {cell.tray_position ? ` · slot ${cell.tray_position}` : ""}
              </Link>
            </div>
          )}
          {cell.burned_barcodes.length > 0 && (
            <div className={styles.burned}>
              <span>Burned:</span>
              <BarcodeChips barcodes={cell.burned_barcodes} />
            </div>
          )}
          {qcFlag && (
            <div className={styles.row}>
              <span>QC</span>
              <Badge tone={CELL_QC_FLAG_TONE[qcFlag]}>{CELL_QC_FLAG_LABEL[qcFlag]}</Badge>
            </div>
          )}

          <CellLifeGantt uses={cell.uses} hoursElapsed={cell.window_hours_elapsed} />

          {runGroups.length > 0 && (
            <div className={styles.uses2}>
              <span className={styles.usesLabel}>Samples &amp; runs</span>
              {runGroups.map((g) => (
                <div key={g.runBatchId} className={styles.runGroup}>
                  <Link
                    to={`/history/runs/${g.runBatchId}`}
                    className={styles.runName}
                    title={runLabel({ run_id: g.runBatchId, run_name: g.runName })}
                  >
                    {runLabel({ run_id: g.runBatchId, run_name: g.runName })}
                  </Link>
                  {g.items.map(({ use, useNo }) => (
                    <div key={use.id} className={styles.useRow}>
                      <UseBox use={useNo} />
                      <Badge tone={USE_STATUS_TONE[use.status] ?? "default"}>{use.status}</Badge>
                      {use.sample_id !== null && use.sample_external_id !== null ? (
                        <Link to={`/samples/${use.sample_id}`} state={backNav} className={styles.useSample}>
                          {use.sample_external_id}
                        </Link>
                      ) : (
                        <span className={styles.useSampleMuted}>no sample</span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
});
