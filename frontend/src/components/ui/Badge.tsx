import type { ReactNode } from "react";

import styles from "./Badge.module.css";

export type BadgeTone =
  | "default"
  | "success"
  | "danger"
  | "warning"
  | "orange"
  | "info"
  | "blue"
  | "purple"
  | "sprq"
  | "ink"
  | "magenta";

export interface BadgeProps {
  tone?: BadgeTone;
  /** Small pill that takes its font from the surrounding line (e.g. the schedule card's mono
   * cell line), so pill text and line text share font metrics and centre exactly. */
  compact?: boolean;
  /** Native hover tooltip explaining the badge (why a sample is flagged, what a state means). */
  title?: string;
  children: ReactNode;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  default: styles.default,
  success: styles.success,
  danger: styles.danger,
  warning: styles.warning,
  orange: styles.orange,
  info: styles.info,
  blue: styles.blue,
  purple: styles.purple,
  sprq: styles.sprq,
  ink: styles.ink,
  magenta: styles.magenta,
};

export function Badge({ tone = "default", compact = false, title, children }: BadgeProps) {
  const classes = [styles.badge, TONE_CLASS[tone]];
  if (compact) classes.push(styles.compact);
  return (
    <span className={classes.join(" ")} title={title}>
      {children}
    </span>
  );
}
