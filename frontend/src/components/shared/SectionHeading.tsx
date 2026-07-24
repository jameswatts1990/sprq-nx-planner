import type { ReactNode } from "react";

import styles from "./SectionHeading.module.css";

export interface SectionHeadingProps {
  title: string;
  legend?: ReactNode;
  /** When set (0–1), the rule line becomes a "loading bar" filled up to this fraction,
   * ending in the RunNx brand dot - used on the weekly schedule to show how far through
   * the displayed week today is. Left as the plain fading rule when omitted. */
  progress?: number;
}

/** Ports the prototype's .sec-head: a title, a fading rule line, and an optional
 * right-aligned legend. Shared between SchedulePage and RunDetailPage. */
export function SectionHeading({ title, legend, progress }: SectionHeadingProps) {
  return (
    <div className={styles.secHead}>
      <h2>{title}</h2>
      {progress == null ? (
        <div className={styles.rule} />
      ) : (
        <div
          className={`${styles.rule} ${styles.ruleProgress}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-label="Progress through the displayed week"
          title="How far through this week today is"
        >
          <div className={styles.ruleTrack} />
          <div className={styles.ruleFill} style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }}>
            <span className={styles.ruleDot} />
          </div>
        </div>
      )}
      {legend && <div className={styles.legend}>{legend}</div>}
    </div>
  );
}

/** The Use 1/2/3 color-swatch legend used alongside the weekly schedule heading. */
export function UseLegend() {
  return (
    <>
      <span className={styles.lg}>
        <span className={`${styles.sw} ${styles.u1}`} />
        Use 1
      </span>
      <span className={styles.lg}>
        <span className={`${styles.sw} ${styles.u2}`} />
        Use 2
      </span>
      <span className={styles.lg}>
        <span className={`${styles.sw} ${styles.u3}`} />
        Use 3
      </span>
    </>
  );
}
