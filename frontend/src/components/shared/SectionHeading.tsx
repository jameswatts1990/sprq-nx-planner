import type { ReactNode } from "react";

import styles from "./SectionHeading.module.css";

export interface SectionHeadingProps {
  title: string;
  legend?: ReactNode;
}

/** Ports the prototype's .sec-head: a title, a fading rule line, and an optional
 * right-aligned legend. Shared between PlanPage and RunDetailPage, which both render
 * a "Weekly schedule" and a "Cell loading map" section in this style. */
export function SectionHeading({ title, legend }: SectionHeadingProps) {
  return (
    <div className={styles.secHead}>
      <h2>{title}</h2>
      <div className={styles.rule} />
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
