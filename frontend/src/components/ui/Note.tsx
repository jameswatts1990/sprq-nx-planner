import type { ReactNode } from "react";

import styles from "./Note.module.css";

export type NoteTone = "warn" | "info" | "bad" | "good";

export interface NoteProps {
  tone: NoteTone;
  icon: string;
  children: ReactNode;
}

const TONE_CLASS: Record<NoteTone, string> = {
  warn: styles.warn,
  info: styles.info,
  bad: styles.bad,
  good: styles.good,
};

export function Note({ tone, icon, children }: NoteProps) {
  return (
    <div className={`${styles.note} ${TONE_CLASS[tone]}`}>
      <span className={styles.ni}>{icon}</span>
      <div>{children}</div>
    </div>
  );
}
