import type { KeyboardEvent, Ref } from "react";

import styles from "./LoadTimePicker.module.css";

/** Selectable load hours, 08:00-20:00 on the hour (13 sectors). */
export const LOAD_HOURS = Array.from({ length: 13 }, (_, i) => i + 8);
const FIRST = LOAD_HOURS[0];
const LAST = LOAD_HOURS[LOAD_HOURS.length - 1];

/** The highlight's start hour: the passed value if it's a selectable hour, else noon. */
export function clampLoadHour(value: number): number {
  return LOAD_HOURS.includes(value) ? value : 12;
}

/** Move the highlight one step around the ring, wrapping at both ends. */
export function stepLoadHour(hour: number, dir: 1 | -1): number {
  if (dir === 1) return hour >= LAST ? FIRST : hour + 1;
  return hour <= FIRST ? LAST : hour - 1;
}

export function fmtHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

export interface LoadTimeDialProps {
  /** The highlighted hour (one of LOAD_HOURS). */
  active: number;
  /** Hover, focus or an arrow key moved the highlight. */
  onActiveChange: (hour: number) => void;
  /** Click / Enter / Space chose an hour. */
  onPick: (hour: number) => void;
  /** Big read-out in the middle of the ring, e.g. "14:00". */
  centerTime: string;
  /** Small caps caption under it, e.g. "loads". */
  centerSub: string;
  onMouseLeave?: () => void;
  ringRef?: Ref<HTMLDivElement>;
}

/** The radial hour ring: 13 hourly sectors 08:00-20:00 on a circle, hour 8 at the top.
 * Shared by LoadTimePicker (pick a new run's load hour) and the Batch Sheet's Load modal
 * (set the real load time). Arrow keys move the highlight; Enter/Space picks it. */
export function LoadTimeDial({
  active,
  onActiveChange,
  onPick,
  centerTime,
  centerSub,
  onMouseLeave,
  ringRef,
}: LoadTimeDialProps) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      onActiveChange(stepLoadHour(active, 1));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      onActiveChange(stepLoadHour(active, -1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPick(active);
    }
  }

  return (
    <div
      ref={ringRef}
      className={styles.ring}
      role="listbox"
      aria-label="Load time"
      aria-activedescendant={`load-time-${active}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseLeave={onMouseLeave}
    >
      {LOAD_HOURS.map((h, i) => (
        <button
          key={h}
          id={`load-time-${h}`}
          type="button"
          role="option"
          aria-selected={h === active}
          aria-label={fmtHour(h)}
          className={`${styles.sector} ${h === active ? styles.active : ""}`}
          style={{ ["--angle" as string]: `${(i / LOAD_HOURS.length) * 360}deg` }}
          onMouseEnter={() => onActiveChange(h)}
          onFocus={() => onActiveChange(h)}
          onClick={() => onPick(h)}
        >
          {h}
        </button>
      ))}
      <div className={styles.center} aria-hidden="true">
        <div className={styles.centerTime}>{centerTime}</div>
        <div className={styles.centerSub}>{centerSub}</div>
      </div>
    </div>
  );
}
