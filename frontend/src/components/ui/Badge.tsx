import type { ReactNode } from "react";

import styles from "./Badge.module.css";

export type BadgeTone = "default" | "success" | "danger" | "warning" | "orange" | "info";

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  default: styles.default,
  success: styles.success,
  danger: styles.danger,
  warning: styles.warning,
  orange: styles.orange,
  info: styles.info,
};

export function Badge({ tone = "default", children }: BadgeProps) {
  return <span className={`${styles.badge} ${TONE_CLASS[tone]}`}>{children}</span>;
}
