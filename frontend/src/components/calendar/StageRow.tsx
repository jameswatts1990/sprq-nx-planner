import { BarcodeChips } from "@/components/shared/BarcodeChips";
import type { StageOut } from "@/types/schedule";
import type { UseClass } from "@/utils/useIndexClass";

import styles from "./StageRow.module.css";

export interface StageRowProps {
  stage: StageOut;
  useClass: UseClass;
}

export function StageRow({ stage, useClass }: StageRowProps) {
  const sampleLabel = stage.sample_external_id ?? "—";
  return (
    <div className={styles.stage}>
      <span className={styles.well}>{stage.well}</span>
      <div className={styles.sinfo}>
        <div className={styles.sname} title={sampleLabel}>
          {sampleLabel}
        </div>
        <div className={styles.cellref}>
          {stage.cell_ref}
          {stage.cell_is_prior ? " · in-prog" : ""}
        </div>
        <BarcodeChips barcodes={stage.barcodes} variant={useClass} />
      </div>
    </div>
  );
}
