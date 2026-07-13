import { useEffect } from "react";
import type { ReactNode } from "react";

import styles from "./Modal.module.css";

export interface ModalProps {
  /** Fired by the overlay click, the Escape key, or the close button. */
  onClose: () => void;
  /** Optional heading rendered at the top of the modal body. */
  title?: ReactNode;
  children: ReactNode;
  /** max-width of the modal box; defaults to 480px. */
  maxWidth?: number;
}

/** Generic centered modal dialog, generalized from CellsPage's inline overlay/modal
 * markup: div.overlay[role=dialog][aria-modal] + inner div.modal (stopPropagation),
 * Escape-to-close. Consumers lay out their own body/footer inside. */
export function Modal({ onClose, title, children, maxWidth }: ModalProps) {
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
        className={styles.modal}
        style={maxWidth ? { maxWidth } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {title !== undefined && <h2 className={styles.title}>{title}</h2>}
        {children}
      </div>
    </div>
  );
}

/** Shared right-aligned footer row for modal actions. */
export function ModalActions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}
