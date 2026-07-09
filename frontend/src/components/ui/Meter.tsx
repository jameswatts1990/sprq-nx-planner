import styles from "./Meter.module.css";

export interface MeterProps {
  value: number;
  max: number;
  /** Forces the "over" (red) fill styling; defaults to value > max. */
  over?: boolean;
  label?: string;
}

/** Generic progress bar - ports the prototype's .wm-bar/.wm-fill/.wm-fill.over visual
 * (originally used for the 108h cell-window meter, generalized here). */
export function Meter({ value, max, over, label }: MeterProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, Math.round((value / max) * 100))) : 0;
  const isOver = over ?? value > max;
  return (
    <div className={styles.wrap}>
      {label && <div className={styles.label}>{label}</div>}
      <div className={styles.bar}>
        <div className={`${styles.fill} ${isOver ? styles.over : ""}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
