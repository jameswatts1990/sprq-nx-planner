import { useLayoutEffect, useRef, useState } from "react";

import type { UseClass } from "@/utils/useIndexClass";

import styles from "./BarcodeChips.module.css";

const MAX_SHOWN = 4;
/** Room held back for the "+N" chip when single-row trimming hides any codes (gap + chip). */
const MORE_CHIP_RESERVE_PX = 30;

export interface BarcodeChipsProps {
  barcodes: string[];
  /** Color-codes the chips per use-index (magenta/blue/teal), default "u1". */
  variant?: UseClass;
  /** Keep the chips on one line: as many as fit are shown and the rest fold into the "+N"
   * chip (measured against the container width, re-measured when it resizes). Used by the
   * dense backlog cards; everywhere else the chips wrap. */
  singleRow?: boolean;
}

/** Ports the prototype's bcChips(): shows up to 4 barcode chips then a "+N" overflow
 * chip whose title tooltip lists the remaining codes. */
export function BarcodeChips({ barcodes, variant = "u1", singleRow = false }: BarcodeChipsProps) {
  const cap = Math.min(MAX_SHOWN, barcodes.length);
  const codesKey = barcodes.join("|");
  // singleRow only: how many chips fit on the line. null = "measure pass" - every candidate
  // chip is rendered so the layout effect can measure them, then trimmed before paint.
  const [fit, setFit] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const measuredWidth = useRef(0);

  // New codes → re-measure.
  useLayoutEffect(() => {
    if (singleRow) setFit(null);
  }, [singleRow, codesKey]);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!singleRow || fit !== null || !row) return;
    const limit = row.clientWidth;
    const rowLeft = row.getBoundingClientRect().left;
    const chips = Array.from(row.querySelectorAll<HTMLElement>("[data-bc]"));
    let n = 0;
    for (let i = 0; i < chips.length; i++) {
      const right = chips[i].getBoundingClientRect().right - rowLeft;
      const reserve = barcodes.length > i + 1 ? MORE_CHIP_RESERVE_PX : 0;
      if (right + reserve > limit) break;
      n = i + 1;
    }
    measuredWidth.current = limit;
    setFit(n);
  }, [singleRow, fit, barcodes.length]);

  // The card list can change width (top-tray grid reflow); re-measure only on a real change.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!singleRow || !row) return;
    const ro = new ResizeObserver(() => {
      if (row.clientWidth !== measuredWidth.current) setFit(null);
    });
    ro.observe(row);
    return () => ro.disconnect();
  }, [singleRow]);

  if (barcodes.length === 0) return null;

  const shownCount = singleRow && fit !== null ? Math.min(fit, cap) : cap;
  const shown = barcodes.slice(0, shownCount);
  const rest = barcodes.slice(shownCount);

  return (
    <div ref={rowRef} className={singleRow ? `${styles.bcs} ${styles.singleRow}` : styles.bcs} data-barcode-chips="">
      {shown.map((code) => (
        <span key={code} data-bc="" className={`${styles.bc} ${styles[variant]}`}>
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
