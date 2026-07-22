import type { ReactNode } from "react";

import styles from "./StatTile.module.css";

export interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Optional sub-line under the value, e.g. a benchmark or "of 24/week". */
  hint?: ReactNode;
}

/** A single labelled KPI number. Promoted from ImportPage's inline .stat markup so the
 * Import result panel and the Stats dashboard share one tile look (uppercase grey label,
 * big tabular-nums value). */
export function StatTile({ label, value, hint }: StatTileProps) {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statVal}>{value}</div>
      {hint !== undefined && <div className={styles.statHint}>{hint}</div>}
    </div>
  );
}

/** Responsive grid of StatTiles (auto-fit, min 120px) - the KPI row. */
export function StatTiles({ children }: { children: ReactNode }) {
  return <div className={styles.stats}>{children}</div>;
}
