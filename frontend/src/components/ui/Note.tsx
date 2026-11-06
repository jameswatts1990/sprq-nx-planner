import type { ReactNode } from "react";

import styles from "./Note.module.css";

export type NoteTone = "warn" | "info" | "bad" | "good";

export interface NoteProps {
  tone: NoteTone;
  icon: string;
  /** "sm" is the compact in-grid variant (Schedule day-note banners): same tones, tighter box,
   * smaller text, no trailing margin. */
  size?: "md" | "sm";
  children: ReactNode;
}

const TONE_CLASS: Record<NoteTone, string> = {
  warn: styles.warn,
  info: styles.info,
  bad: styles.bad,
  good: styles.good,
};

/** A bad-tone Note is an error the user has to act on, so screen readers announce it as it appears. */
export function Note({ tone, icon, size = "md", children }: NoteProps) {
  return (
    <div
      className={[styles.note, TONE_CLASS[tone], size === "sm" ? styles.sm : ""].filter(Boolean).join(" ")}
      role={tone === "bad" ? "alert" : undefined}
    >
      <span className={styles.ni} aria-hidden="true">
        {icon}
      </span>
      <div>{children}</div>
    </div>
  );
}
