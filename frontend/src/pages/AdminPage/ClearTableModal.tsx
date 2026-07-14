import { useState } from "react";

import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";

import styles from "./AdminPage.module.css";

export interface ClearTableModalProps {
  table: string;
  rowCount: number;
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Destructive "clear all rows" confirmation - requires typing the table name
 * exactly before the confirm button enables, in the same spirit as
 * SchedulePage/ClearScheduleModal.tsx but stronger since this has no undo path
 * at all (the schedule version at least returns samples to the backlog). */
export function ClearTableModal({ table, rowCount, pending, error, onCancel, onConfirm }: ClearTableModalProps) {
  const [confirmText, setConfirmText] = useState("");
  const matches = confirmText === table;

  return (
    <Modal onClose={pending ? () => {} : onCancel} title={`Clear table "${table}"?`}>
      <p className={styles.helper}>
        This permanently deletes all {rowCount} row{rowCount === 1 ? "" : "s"} in <b>{table}</b>. The table itself is
        kept and remains usable. This can&apos;t be undone.
      </p>
      <p className={styles.helper}>
        Type <b>{table}</b> to confirm:
      </p>
      <input
        className={styles.confirmInput}
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder={table}
        autoFocus
      />

      {error !== null && error !== undefined && (
        <Note tone="bad" icon="!">
          {error instanceof ApiError ? error.message : "Failed to clear table."}
        </Note>
      )}

      <ModalActions>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          variant="primary"
          className={styles.dangerButton}
          onClick={onConfirm}
          disabled={pending || !matches}
        >
          {pending ? "Clearing…" : `Clear ${rowCount} row${rowCount === 1 ? "" : "s"}`}
        </Button>
      </ModalActions>
    </Modal>
  );
}
