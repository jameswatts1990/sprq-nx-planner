import { BarcodeChips } from "@/components/shared/BarcodeChips";
import type { PackedCellOut } from "@/types/schedule";

import styles from "./CellCard.module.css";
import { UseRow } from "./UseRow";
import { WindowMeter } from "./WindowMeter";

export interface CellCardProps {
  cell: PackedCellOut;
}

/** Preview-time cell card (used on the Plan page for a live preview of PackedCellOut). */
export function CellCard({ cell }: CellCardProps) {
  const usesConsumed = cell.total_uses - cell.future_uses;
  const headLabel = cell.cell_ref || (cell.cell_id !== null ? String(cell.cell_id) : "—");
  const headClasses = [styles.head];
  if (cell.is_prior) headClasses.push(styles.prior);

  return (
    <div className={styles.card}>
      <div className={headClasses.join(" ")}>
        <span className={styles.cid}>{headLabel}</span>
        {cell.is_prior && <span className={styles.priorTag}>IN PROGRESS</span>}
        {cell.instrument_serial && (
          <span className={styles.loc}>
            {cell.instrument_serial} · stage {cell.stage_no ?? "?"}
          </span>
        )}
      </div>
      <div className={styles.body}>
        {cell.is_prior && cell.burned_barcodes.length > 0 && (
          <div className={styles.burned}>
            <span>Already burned:</span>
            <BarcodeChips barcodes={cell.burned_barcodes} variant="u2" />
          </div>
        )}
        {cell.uses.map((use, i) => (
          <UseRow
            key={use.sample_id ?? `${use.sample_external_id}-${i}`}
            useNumber={usesConsumed + i + 1}
            sampleExternalId={use.sample_external_id}
            barcodes={use.barcodes}
          />
        ))}
        {cell.total_uses >= 2 && <WindowMeter windowHours={cell.window_hours} />}
      </div>
    </div>
  );
}
