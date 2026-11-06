import { useRef } from "react";
import type { ReactNode } from "react";

import { Button } from "./Button";
import styles from "./Modal.module.css";
import { useDialogA11y } from "./useDialogA11y";

export interface ModalProps {
  /** Fired by an overlay click, the Escape key, or the title row's ✕ close button. */
  onClose: () => void;
  /** Optional heading rendered at the top of the modal body, with a ✕ close button beside it
   * (the same ghost icon button as Drawer). Omit it and the modal has no title row and no ✕ -
   * the caller then owns its own header. */
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

/** Generic centered modal dialog: div.overlay + the dialog box (role=dialog, named by its title),
 * with focus, Esc and overlay behaviour from useDialogA11y. The box stops click propagation, so a
 * modal opened from inside a clickable card never re-triggers the card. Consumers lay out their
 * own body/footer inside. */
export function Modal({ onClose, title, titleExtra, children, maxWidth, fullScreen }: ModalProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const { titleId, overlayProps, boxProps } = useDialogA11y(boxRef, onClose);

  return (
    <div className={styles.overlay} {...overlayProps}>
      <div
        ref={boxRef}
        {...boxProps}
        aria-labelledby={title !== undefined ? titleId : undefined}
        className={fullScreen ? `${styles.modal} ${styles.fullScreen}` : styles.modal}
        style={!fullScreen && maxWidth ? { maxWidth } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {(title !== undefined || titleExtra !== undefined) && (
          <div className={styles.titleRow}>
            {title !== undefined && (
              <h2 id={titleId} className={styles.title}>
                {title}
              </h2>
            )}
            <div className={styles.titleExtra}>
              {titleExtra}
              {title !== undefined && (
                <Button variant="ghost" icon className={styles.close} onClick={onClose} aria-label="Close">
                  ✕
                </Button>
              )}
            </div>
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
