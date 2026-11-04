import { useEffect, useRef, useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/SegmentedControl";
import type { CellType } from "@/types/common";
import { DEFAULT_CELL_TYPE } from "@/utils/cellType";

import { clampLoadHour, fmtHour, LoadTimeDial } from "./LoadTimeDial";

import styles from "./LoadTimePicker.module.css";

const CELL_TYPE_OPTIONS: SegmentedOption<CellType>[] = [
  {
    value: "sprq_nx",
    label: "SPRQ-Nx",
    hint: "up to 3 uses",
    title: "Multi-use SPRQ-Nx cells - each cell can be reused up to 3 times within 108 h",
  },
  {
    value: "sprq",
    label: "SPRQ",
    hint: "single use",
    title: "Single-use SPRQ cells - each cell runs once (e.g. for <5 kb amplicons)",
  },
];

/** What each choice will do, shown under the toggle so the outcome is clear before the click. */
const CELL_TYPE_HINT: Record<CellType, string> = {
  sprq_nx: "Reuses SPRQ-Nx cells already on this instrument first, otherwise opens a new SPRQ-Nx tray.",
  sprq: "The whole run uses single-use SPRQ cells: leftover SPRQ cells on this instrument first, otherwise a new SPRQ tray.",
};

export interface LoadTimePickerProps {
  /** Pre-selected/highlighted hour (8-20). Out-of-range falls back to noon. */
  value: number;
  /** Fired with the chosen hour (minute is always :00) and the cell type picked on the toggle
   * (always SPRQ-Nx when the toggle isn't shown). */
  onPick: (hour: number, cellType: CellType) => void;
  /** Fired on Escape / overlay click / Cancel - no run is created. */
  onCancel: () => void;
  title?: string;
  /** Optional one-line context under the title (e.g. which day this run loads). */
  subtitle?: string;
  /** Show the SPRQ-Nx / SPRQ cell-type toggle above the dial - for a brand-new run's first drop,
   * where it sets the whole run's cell type. Starts on SPRQ-Nx each time the dial opens. */
  showCellType?: boolean;
}

/**
 * A radial "quick-select" wheel for a run's load time - the hour the operator racks its plates
 * (the cells then prep ~4h before the movie starts). 13 hourly sectors 08:00-20:00 arranged on a
 * circle; the centre shows the currently-highlighted time. Hover or arrow-key to move the
 * highlight, click / Enter to pick, Escape (or the overlay) to cancel. Rendered inside the
 * shared Modal so overlay + Escape + focus behaviour matches the rest of the app.
 */
export function LoadTimePicker({
  value,
  onPick,
  onCancel,
  title = "Load time",
  subtitle,
  showCellType = false,
}: LoadTimePickerProps) {
  const [active, setActive] = useState(clampLoadHour(value));
  const [cellType, setCellType] = useState<CellType>(DEFAULT_CELL_TYPE);
  const ringRef = useRef<HTMLDivElement>(null);

  // Focus the ring so arrow keys / Enter work without a click first.
  useEffect(() => {
    ringRef.current?.focus();
  }, []);

  // Escape is handled by Modal's onClose (-> onCancel).
  return (
    <Modal onClose={onCancel} title={title} maxWidth={340}>
      <p className={styles.hint}>{subtitle ?? "Pick when this run loads (its cells prep, then sequencing starts)."}</p>
      {showCellType && (
        <div className={styles.cellType}>
          <SegmentedControl
            options={CELL_TYPE_OPTIONS}
            value={cellType}
            onChange={(t) => {
              setCellType(t);
              // Hand focus back to the ring so arrow keys / Enter keep driving the dial.
              ringRef.current?.focus();
            }}
            ariaLabel="Cell type"
            fullWidth
          />
          <p className={`${styles.cellTypeHint} ${cellType === "sprq" ? styles.cellTypeHintSprq : ""}`}>
            {CELL_TYPE_HINT[cellType]}
          </p>
        </div>
      )}
      <LoadTimeDial
        ringRef={ringRef}
        active={active}
        onActiveChange={setActive}
        onPick={(h) => onPick(h, cellType)}
        centerTime={fmtHour(active)}
        centerSub="loads"
      />
    </Modal>
  );
}
