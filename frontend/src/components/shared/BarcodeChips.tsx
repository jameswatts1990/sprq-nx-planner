import type { UseClass } from "@/utils/useIndexClass";

import styles from "./BarcodeChips.module.css";

const MAX_SHOWN = 4;

export interface BarcodeChipsProps {
  barcodes: string[];
  /** Color-codes the chips per use-index (magenta/blue/teal, or indigo for a single-use SPRQ
   * cell), default "u1". */
  variant?: UseClass;
  /** Every code on one line that runs off the end with "…" instead of wrapping or folding into
   * "+N" (the full list is in the row's tooltip). Used by the dense backlog cards. */
  singleLine?: boolean;
}

/** Ports the prototype's bcChips(): shows up to 4 barcode chips then a "+N" overflow
 * chip whose title tooltip lists the remaining codes. */
export function BarcodeChips({ barcodes, variant = "u1", singleLine = false }: BarcodeChipsProps) {
  if (barcodes.length === 0) return null;

  if (singleLine) {
    // Inline (not flex) chips in a nowrap block, so the browser's text-overflow ellipsis can
    // cut the last visible code mid-way and end the line with "…".
    return (
      <div className={styles.singleLine} title={barcodes.join(", ")} data-barcode-chips="">
        {barcodes.map((code) => (
          <span key={code} className={`${styles.bc} ${styles[variant]}`}>
            {code}
          </span>
        ))}
      </div>
    );
  }

  const shown = barcodes.slice(0, MAX_SHOWN);
  const rest = barcodes.slice(MAX_SHOWN);

  return (
    <div className={styles.bcs} data-barcode-chips="">
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
