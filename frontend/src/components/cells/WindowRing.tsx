import { CELL_LIFETIME_H, FADE_MIN_HOURS } from "@/utils/windowFade";

import styles from "./WindowRing.module.css";

const R = 30;
const CIRC = 2 * Math.PI * R; // ~188.5

export interface WindowRingProps {
  /** Hours into the cell's own 108h window; null when there's no live window to read
   * (a terminally done cell), which renders a neutral ring with the idle centre text. */
  hoursElapsed: number | null;
  /** Centre / sub text when hoursElapsed is null (no live countdown). */
  idleCenter?: string;
  idleSub?: string;
}

/**
 * The cell card's single focal gauge: how much of the 108h reuse window is gone, as a ring
 * that fills and shifts green -> amber (< FADE_MIN_HOURS left, the app's "urgent" threshold)
 * -> red (over). The centre reads the hours remaining. Draws from windowFade so the ring and
 * the grid's expiry shading share one deadline definition.
 */
export function WindowRing({ hoursElapsed, idleCenter = "—", idleSub = "" }: WindowRingProps) {
  let pct = 0;
  let colorVar = "var(--line-hover)";
  let center = idleCenter;
  let sub = idleSub;
  let over = false;
  let aria = "No live 108-hour window";

  if (hoursElapsed !== null) {
    const left = CELL_LIFETIME_H - hoursElapsed;
    over = left <= 0;
    pct = Math.min(hoursElapsed / CELL_LIFETIME_H, 1);
    if (over) {
      colorVar = "var(--red)";
      center = "over";
      sub = `${CELL_LIFETIME_H} h`;
      pct = 1;
      aria = "108-hour window exceeded";
    } else {
      colorVar = left <= FADE_MIN_HOURS ? "var(--amber)" : "var(--green)";
      center = String(Math.round(left));
      sub = "h left";
      aria = `${Math.round(left)} hours left in the 108-hour window`;
    }
  }

  const dash = `${(CIRC * pct).toFixed(1)} ${CIRC.toFixed(3)}`;

  return (
    <div className={styles.ring} role="img" aria-label={aria}>
      <svg viewBox="0 0 80 80" width="76" height="76" aria-hidden="true">
        <circle cx="40" cy="40" r={R} fill="none" stroke="var(--line-soft)" strokeWidth="8" />
        <circle
          cx="40"
          cy="40"
          r={R}
          fill="none"
          stroke={colorVar}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={dash}
          transform="rotate(-90 40 40)"
        />
      </svg>
      <div className={styles.center}>
        <span className={`${styles.num} ${over ? styles.over : ""}`}>{center}</span>
        {sub && <span className={styles.sub}>{sub}</span>}
      </div>
    </div>
  );
}
