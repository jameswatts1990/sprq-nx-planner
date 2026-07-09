import { Meter } from "@/components/ui/Meter";

import styles from "./WindowMeter.module.css";

/** Hours from first breakout to the start of use 3 that a multi-use cell has to stay
 * within; ported from the prototype's CELL_LIFETIME_H constant. */
export const CELL_LIFETIME_H = 108;

export interface WindowMeterProps {
  windowHours: number;
}

/** Wraps ui/Meter.tsx with the "108h window" framing used on cell cards. */
export function WindowMeter({ windowHours }: WindowMeterProps) {
  const over = windowHours > CELL_LIFETIME_H;
  return (
    <div className={styles.windowMeter}>
      <div className={styles.label}>
        <span>108 h window</span>
        <span>
          {windowHours.toFixed(1)} h / {CELL_LIFETIME_H} h
        </span>
      </div>
      <Meter value={windowHours} max={CELL_LIFETIME_H} over={over} />
    </div>
  );
}
