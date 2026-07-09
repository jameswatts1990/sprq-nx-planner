import type { ReactNode } from "react";

import styles from "./KpiStrip.module.css";

export function KpiStrip({ children }: { children: ReactNode }) {
  return <div className={styles.kpis}>{children}</div>;
}
