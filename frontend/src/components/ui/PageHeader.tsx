import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import styles from "./PageHeader.module.css";

export interface PageHeaderProps {
  title: ReactNode;
  /** One short line under the title saying what the page is for, or a live summary
   * ("42 samples waiting to be scheduled"). */
  intro?: ReactNode;
  /** Page-level buttons/links, right-aligned on the title row. */
  actions?: ReactNode;
  /** Back link above the title, rendered as "◂ <label>" - the one back-link pattern for
   * every detail page. */
  back?: { to: string; label: string };
}

/** The one way every page opens: an h1 on the type scale's display step, an optional intro
 * line and an optional actions slot. The Schedule page is the deliberate exception - it keeps
 * its dense SectionHeading so the grid starts as high as possible. */
export function PageHeader({ title, intro, actions, back }: PageHeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.titles}>
        {back && (
          <Link to={back.to} className={styles.back}>
            ◂ {back.label}
          </Link>
        )}
        <h1 className={styles.title}>{title}</h1>
        {intro !== undefined && <p className={styles.intro}>{intro}</p>}
      </div>
      {actions !== undefined && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
