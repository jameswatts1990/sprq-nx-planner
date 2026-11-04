import type { ReactNode } from "react";

import styles from "./StatTile.module.css";

export interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Optional sub-line under the value, e.g. a benchmark or "of 24/week". */
  hint?: ReactNode;
  /** Span two grid columns instead of one — for a tile that deserves more room. */
  wide?: boolean;
  /** Hover tooltip explaining what the number counts. */
  title?: string;
}

/** A single labelled KPI number. Promoted from ImportPage's inline .stat markup so the
 * Import result panel, the Stats dashboard and the QC overview share one tile look (uppercase
 * grey label, big tabular-nums value). */
export function StatTile({ label, value, hint, wide, title }: StatTileProps) {
  return (
    <div className={wide ? `${styles.stat} ${styles.wide}` : styles.stat} title={title}>
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
