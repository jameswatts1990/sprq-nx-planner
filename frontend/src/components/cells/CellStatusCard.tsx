import { memo } from "react";
import { Link } from "react-router-dom";

import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Badge } from "@/components/ui/Badge";
import type { CellOut } from "@/types/cell";
import { CELL_QC_FLAG_LABEL, CELL_QC_FLAG_TONE } from "@/utils/cellQcFlag";
import { CELL_STATUS_LABEL, CELL_STATUS_TONE } from "@/utils/cellStatus";
import { runLabel } from "@/utils/runLabel";
import { useSampleBackNav } from "@/utils/sampleBackNav";
import { USE_STATUS_TONE } from "@/utils/useStatusTone";

import styles from "./CellStatusCard.module.css";
import { WindowMeter } from "./WindowMeter";

export interface CellStatusCardProps {
  cell: CellOut;
}

/** Live-cell card backed by CellOut. Unlike the old whole-card <Link>, the card now links
 * to several destinations (its own cell page via the code, its tray, and each sample/run
 * it has been used by), so it's a plain container with inner links rather than one anchor -
 * nested anchors aren't valid. Memoized so a grid of up to ~100 cards doesn't all re-render
 * on an unrelated CellsPage state change (e.g. a keystroke in the search box before its
 * debounce fires) - each card only re-renders when its own cell object changes (stable
 * across refetches via React Query's structural sharing). */
export const CellStatusCard = memo(function CellStatusCard({ cell }: CellStatusCardProps) {
  const backNav = useSampleBackNav();
  const showWindowMeter =
    cell.status !== "exhausted" &&
    cell.status !== "retired" &&
    cell.status !== "stopped" &&
    cell.window_hours_elapsed !== null;
  const qcFlag = cell.needs_qc_report ? "unreported" : cell.awaiting_credit ? "awaiting_credit" : null;

  return (
    <article className={styles.card}>
      <div className={styles.head}>
        <Link to={`/cells/${cell.id}`} className={styles.cid}>
          {cell.code}
        </Link>
        <Badge tone={CELL_STATUS_TONE[cell.status]}>{CELL_STATUS_LABEL[cell.status]}</Badge>
        <span className={styles.uses}>
          {cell.uses_consumed} / {cell.max_uses} uses
        </span>
      </div>
      <div className={styles.body}>
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
            <Link to={`/cells?tray=${cell.tray_id}`}>Tray {cell.tray_id}</Link>
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
        {showWindowMeter && <WindowMeter windowHours={cell.window_hours_elapsed as number} />}

        {cell.uses.length > 0 && (
          <div className={styles.uses2}>
            <span className={styles.usesLabel}>Samples &amp; runs</span>
            {cell.uses.map((u) => (
              <div key={u.id} className={styles.useRow}>
                <Badge tone={USE_STATUS_TONE[u.status] ?? "default"}>{u.status}</Badge>
                {u.sample_id !== null && u.sample_external_id !== null ? (
                  <Link to={`/samples/${u.sample_id}`} state={backNav} className={styles.useSample}>
                    {u.sample_external_id}
                  </Link>
                ) : (
                  <span className={styles.useSampleMuted}>no sample</span>
                )}
                <span className={styles.useSep}>·</span>
                <Link to={`/history/runs/${u.run_batch_id}`} className={styles.useRun}>
                  {runLabel({ run_id: u.run_batch_id, run_name: u.run_name })}
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  );
});
