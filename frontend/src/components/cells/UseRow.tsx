import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { classForUseIndex } from "@/utils/useIndexClass";

import styles from "./UseRow.module.css";

export interface UseRowProps {
  useNumber: number;
  sampleExternalId: string;
  barcodes: string[];
}

/** Colored "Use N" badge + BarcodeChips, one per entry in a cell's uses. */
export function UseRow({ useNumber, sampleExternalId, barcodes }: UseRowProps) {
  const useClass = classForUseIndex(useNumber);
  return (
    <div className={styles.useRow}>
      <span className={`${styles.badge} ${styles[useClass]}`}>Use {useNumber}</span>
      <div className={styles.info}>
        <div className={styles.name}>{sampleExternalId}</div>
        <BarcodeChips barcodes={barcodes} variant={useClass} />
      </div>
    </div>
  );
}
