import type { ReactNode } from "react";

import styles from "./KpiTile.module.css";

export type KpiAccent = "default" | "blue" | "teal" | "purple";
export type KpiTrend = "up" | "down";

export interface KpiTileProps {
  label: string;
  value: ReactNode;
  unit?: ReactNode;
  accent?: KpiAccent;
  trend?: KpiTrend;
}

const ACCENT_CLASS: Record<KpiAccent, string | undefined> = {
  default: undefined,
  blue: styles.blue,
  teal: styles.teal,
  purple: styles.purple,
};

export function KpiTile({ label, value, unit, accent = "default", trend }: KpiTileProps) {
  const accentClass = ACCENT_CLASS[accent];
  const valueClass = trend === "up" ? styles.up : trend === "down" ? styles.down : undefined;
  const kpiClasses = [styles.kpi, accentClass].filter(Boolean).join(" ");
  const valClasses = [styles.val, valueClass].filter(Boolean).join(" ");
  return (
    <div className={kpiClasses}>
      <div className={styles.label}>{label}</div>
      <div className={valClasses}>{value}</div>
      {unit !== undefined && <div className={styles.unit}>{unit}</div>}
    </div>
  );
}
