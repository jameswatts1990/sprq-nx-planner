import { Link } from "react-router-dom";

import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Badge } from "@/components/ui/Badge";
import type { CellOut } from "@/types/cell";
import { CELL_QC_FLAG_LABEL, CELL_QC_FLAG_TONE } from "@/utils/cellQcFlag";
import { CELL_STATUS_LABEL, CELL_STATUS_TONE } from "@/utils/cellStatus";

import styles from "./CellStatusCard.module.css";
import { WindowMeter } from "./WindowMeter";

export interface CellStatusCardProps {
  cell: CellOut;
}

/** Live-cell card backed by CellOut; links through to the cell detail page. */
export function CellStatusCard({ cell }: CellStatusCardProps) {
  const showWindowMeter =
    cell.status !== "exhausted" &&
    cell.status !== "retired" &&
    cell.status !== "stopped" &&
    cell.window_hours_elapsed !== null;
  const qcFlag = cell.needs_qc_report ? "unreported" : cell.awaiting_credit ? "awaiting_credit" : null;

  return (
    <Link to={`/cells/${cell.id}`} className={styles.card}>
      <div className={styles.head}>
        <span className={styles.cid}>{cell.code}</span>
        <Badge tone={CELL_STATUS_TONE[cell.status]}>{CELL_STATUS_LABEL[cell.status]}</Badge>
        <span className={styles.uses}>
          {cell.uses_consumed} / {cell.max_uses} uses
        </span>
      </div>
      <div className={styles.body}>
        {cell.current_instrument_serial && (
          <div className={styles.row}>
            <span>Instrument</span>
            <b>
              {cell.current_instrument_serial}
              {cell.current_well ? ` · ${cell.current_well}` : ""}
            </b>
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
      </div>
    </Link>
  );
}
