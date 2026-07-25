import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Modal } from "@/components/ui/Modal";

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

export interface LoadTimePickerProps {
  /** Pre-selected/highlighted hour (8-20). Out-of-range falls back to noon. */
  value: number;
  /** Fired with the chosen hour (minute is always :00). */
  onPick: (hour: number) => void;
  /** Fired on Escape / overlay click / Cancel - no run is created. */
  onCancel: () => void;
  title?: string;
  /** Optional one-line context under the title (e.g. which day this run loads). */
  subtitle?: string;
}

/**
 * A radial "quick-select" wheel for a run's load time - the hour it loads and (since there
 * are no pre-loaded runs) starts sequencing. 13 hourly sectors 08:00-20:00 arranged on a
 * circle; the centre shows the currently-highlighted time. Hover or arrow-key to move the
 * highlight, click / Enter to pick, Escape (or the overlay) to cancel. Rendered inside the
 * shared Modal so overlay + Escape + focus behaviour matches the rest of the app.
 */
export function LoadTimePicker({ value, onPick, onCancel, title = "Load time", subtitle }: LoadTimePickerProps) {
  const [active, setActive] = useState(clampLoadHour(value));
  const ringRef = useRef<HTMLDivElement>(null);

  // Focus the ring so arrow keys / Enter work without a click first.
  useEffect(() => {
    ringRef.current?.focus();
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      setActive((h) => stepLoadHour(h, 1));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((h) => stepLoadHour(h, -1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPick(active);
    }
    // Escape is handled by Modal's onClose (-> onCancel).
  }

  return (
    <Modal onClose={onCancel} title={title} maxWidth={340}>
      <p className={styles.hint}>{subtitle ?? "Pick when this run loads and starts sequencing."}</p>
      <div
        ref={ringRef}
        className={styles.ring}
        role="listbox"
        aria-label="Load time"
        aria-activedescendant={`load-time-${active}`}
        tabIndex={0}
        onKeyDown={onKeyDown}
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
            onMouseEnter={() => setActive(h)}
            onFocus={() => setActive(h)}
            onClick={() => onPick(h)}
          >
            {h}
          </button>
        ))}
        <div className={styles.center} aria-hidden="true">
          <div className={styles.centerTime}>{fmtHour(active)}</div>
          <div className={styles.centerSub}>loads</div>
        </div>
      </div>
    </Modal>
  );
}
