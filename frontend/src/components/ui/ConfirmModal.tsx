import type { ReactNode } from "react";

import { Button } from "./Button";
import { Modal, ModalActions } from "./Modal";
import { Note } from "./Note";
import styles from "./ConfirmModal.module.css";

export interface ConfirmModalTextareaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export interface ConfirmModalProps {
  title: ReactNode;
  /** Explanatory copy above the (optional) textarea - a helper paragraph and/or a Note. */
  children?: ReactNode;
  /** Optional labeled textarea (e.g. a reason/notes field); omitted for warning-only confirms. */
  textarea?: ConfirmModalTextareaProps;
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  /** Pre-resolved error message (caller does its own ApiError check, matching the rest of the app). */
  error?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Shared shell for the "explain, optionally collect a note, confirm/cancel" dialogs used
 * for cell/use QC actions (Stop, Undo stop, Mark Failed, Mark Aborted, Undo) - these had
 * grown into five near-identical copies of the same Modal/ModalActions markup. Callers
 * keep their own state (and mount/unmount to get a fresh textarea each open); this only
 * owns the shared presentation. */
export function ConfirmModal({
  title,
  children,
  textarea,
  confirmLabel,
  pendingLabel,
  pending,
  error,
  onCancel,
  onConfirm,
}: ConfirmModalProps) {
  return (
    <Modal onClose={pending ? () => {} : onCancel} title={title}>
      {children}

      {textarea && (
        <div className={styles.field}>
          <label className={styles.fieldLabel}>{textarea.label}</label>
          <textarea
            value={textarea.value}
            onChange={(e) => textarea.onChange(e.target.value)}
            placeholder={textarea.placeholder}
          />
        </div>
      )}

      {error != null && (
        <Note tone="bad" icon="!">
          {error}
        </Note>
      )}

      <ModalActions>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onConfirm} disabled={pending}>
          {pending ? pendingLabel : confirmLabel}
        </Button>
      </ModalActions>
    </Modal>
  );
}
