import { useEffect } from "react";
import type { ReactNode } from "react";

import styles from "./Modal.module.css";

export interface ModalProps {
  /** Fired by the overlay click, the Escape key, or the close button. */
  onClose: () => void;
  /** Optional heading rendered at the top of the modal body. */
  title?: ReactNode;
  /** Optional content rendered top-right, alongside the title (e.g. quick actions). */
  titleExtra?: ReactNode;
  children: ReactNode;
  /** max-width of the modal box; defaults to 480px. Ignored when `fullScreen` is set. */
  maxWidth?: number;
  /** Fills the viewport (minus the overlay's own padding) instead of the default centered,
   * width-capped box — for content that needs real room (e.g. a week-long chart) rather than
   * a dialog. Escape/overlay-click/stopPropagation behave identically either way. */
  fullScreen?: boolean;
}

/** Generic centered modal dialog, generalized from CellsPage's inline overlay/modal
 * markup: div.overlay[role=dialog][aria-modal] + inner div.modal (stopPropagation),
 * Escape-to-close. Consumers lay out their own body/footer inside. */
export function Modal({ onClose, title, titleExtra, children, maxWidth, fullScreen }: ModalProps) {
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
        className={fullScreen ? `${styles.modal} ${styles.fullScreen}` : styles.modal}
        style={!fullScreen && maxWidth ? { maxWidth } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {(title !== undefined || titleExtra !== undefined) && (
          <div className={styles.titleRow}>
            {title !== undefined && <h2 className={styles.title}>{title}</h2>}
            {titleExtra !== undefined && <div className={styles.titleExtra}>{titleExtra}</div>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** Shared right-aligned footer row for modal actions. */
export function ModalActions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}
