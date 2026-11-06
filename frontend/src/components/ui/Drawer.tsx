import { useRef } from "react";
import type { ReactNode } from "react";

import { Button } from "./Button";
import styles from "./Drawer.module.css";
import { useDialogA11y } from "./useDialogA11y";

export interface DrawerProps {
  /** Fired by a scrim click, the Escape key, or the close button. */
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

/** A side pop-out panel with Modal's focus, Esc and overlay behaviour (useDialogA11y), but docked
 * to one edge and full-height instead of centered. Used for the Schedule page's Autoschedule
 * panel, whose controls act on the grid selection behind it, so the scrim is deliberately light
 * and the grid stays visible underneath. */
export function Drawer({ onClose, title, subtitle, side = "left", width = 380, children }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { titleId, overlayProps, boxProps } = useDialogA11y(panelRef, onClose);

  return (
    <div className={styles.overlay} {...overlayProps}>
      <div
        ref={panelRef}
        {...boxProps}
        aria-labelledby={titleId}
        className={`${styles.panel} ${side === "right" ? styles.right : styles.left}`}
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <div className={styles.titleBlock}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {subtitle !== undefined && <div className={styles.subtitle}>{subtitle}</div>}
          </div>
          <Button variant="ghost" icon className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
