import { useEffect } from "react";
import type { ReactNode } from "react";

import styles from "./Drawer.module.css";

export interface DrawerProps {
  /** Fired by the scrim click, the Escape key, or the close button. */
  onClose: () => void;
  /** Heading shown in the drawer's pinned header, next to the close button. */
  title: ReactNode;
  /** Optional smaller line under the title (e.g. a live settings summary). */
  subtitle?: ReactNode;
  /** Which edge the panel slides in from. Defaults to the left. */
  side?: "left" | "right";
  /** Panel width in px; defaults to 380. */
  width?: number;
  children: ReactNode;
}

/** A side pop-out panel, built on the same overlay/Escape/stop-propagation pattern as
 * Modal but docked to one edge and full-height instead of centered. Used for the
 * Schedule page's Autoschedule panel, whose controls act on the grid selection behind
 * it, so the scrim is deliberately light and the grid stays visible underneath. */
export function Drawer({ onClose, title, subtitle, side = "left", width = 380, children }: DrawerProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className={`${styles.panel} ${side === "right" ? styles.right : styles.left}`}
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <div className={styles.titleBlock}>
            <h2 className={styles.title}>{title}</h2>
            {subtitle !== undefined && <div className={styles.subtitle}>{subtitle}</div>}
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
