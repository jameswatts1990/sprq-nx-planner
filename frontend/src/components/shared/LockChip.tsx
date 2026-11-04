import type { ReactNode } from "react";

import styles from "./LockChip.module.css";

export interface LockChipProps {
  /** Hover tooltip (and the accessible name when there's no label): what is locked, until when. */
  title: string;
  /** Visible text beside the padlock ("Prep-locked", a carried-over plate's run). Omit it for the
   * icon-only chip - the release time then lives in the tooltip, never in an expanding chip. */
  label?: ReactNode;
  /** "carry" = outlined, for a lock inherited from an earlier day's run (its Plate 2 runs on). */
  variant?: "solid" | "carry";
  /** "sm" sits in the dense Schedule grid; "md" on ordinary pages (Instruments). */
  size?: "sm" | "md";
}

/** The app's one "this instrument is locked" marker: a teal padlock chip. Teal is the grid's
 * neutral informational tone - a lock is a fact about the instrument, not a warning, so it
 * borrows no status colour. The Revio screen mimic keeps its own instrument-styled lock. */
export function LockChip({ title, label, variant = "solid", size = "sm" }: LockChipProps) {
  const className = [styles.chip, styles[size], variant === "carry" ? styles.carry : ""].filter(Boolean).join(" ");
  return (
    <span
      className={className}
      title={title}
      role={label === undefined ? "img" : undefined}
      aria-label={label === undefined ? title : undefined}
    >
      <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={styles.icon}>
        <path d="M4 7V5a4 4 0 1 1 8 0v2h.5A1.5 1.5 0 0 1 14 8.5v5A1.5 1.5 0 0 1 12.5 15h-9A1.5 1.5 0 0 1 2 13.5v-5A1.5 1.5 0 0 1 3.5 7H4Zm1.5 0h5V5a2.5 2.5 0 0 0-5 0v2Z" />
      </svg>
      {label !== undefined && <span>{label}</span>}
    </span>
  );
}
