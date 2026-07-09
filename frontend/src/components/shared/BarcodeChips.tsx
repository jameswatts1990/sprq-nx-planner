import type { UseClass } from "@/utils/useIndexClass";

import styles from "./BarcodeChips.module.css";

const MAX_SHOWN = 4;

export interface BarcodeChipsProps {
  barcodes: string[];
  /** Color-codes the chips per use-index (magenta/blue/teal), default "u1". */
  variant?: UseClass;
}

/** Ports the prototype's bcChips(): shows up to 4 barcode chips then a "+N" overflow
 * chip whose title tooltip lists the remaining codes. */
export function BarcodeChips({ barcodes, variant = "u1" }: BarcodeChipsProps) {
  if (barcodes.length === 0) return null;

  const shown = barcodes.slice(0, MAX_SHOWN);
  const rest = barcodes.slice(MAX_SHOWN);

  return (
    <div className={styles.bcs}>
      {shown.map((code) => (
        <span key={code} className={`${styles.bc} ${styles[variant]}`}>
          {code}
        </span>
      ))}
      {rest.length > 0 && (
        <span className={`${styles.bc} ${styles.more}`} title={rest.join(", ")}>
          +{rest.length}
        </span>
      )}
    </div>
  );
}
