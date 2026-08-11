import { useState } from "react";

import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";

import styles from "./SettingsPage.module.css";

/** A cell value as an editable string: null/undefined -> "" (empty field = null on save),
 * objects (e.g. JSON columns) -> their JSON text, everything else -> String(). */
function toInput(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export interface RowEditModalProps {
  table: string;
  columns: string[];
  primaryKey: string[];
  row: Record<string, unknown>;
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onSave: (values: Record<string, unknown>) => void;
}

/** Raw per-row column editor for the developer tools. Edits every non-primary-key column
 * as free text and saves only the fields the user actually changed - matching the raw,
 * invariant-bypassing nature of the delete/clear tools alongside it. */
export function RowEditModal({ table, columns, primaryKey, row, pending, error, onCancel, onSave }: RowEditModalProps) {
  const pkSet = new Set(primaryKey);
  const editable = columns.filter((c) => !pkSet.has(c));
  const initial: Record<string, string> = Object.fromEntries(editable.map((c) => [c, toInput(row[c])]));
  const [form, setForm] = useState<Record<string, string>>(initial);

  const changed = editable.filter((c) => form[c] !== initial[c]);

  function handleSave() {
    const values: Record<string, unknown> = {};
    for (const c of changed) values[c] = form[c] === "" ? null : form[c];
    onSave(values);
  }

  return (
    <Modal onClose={pending ? () => {} : onCancel} title={`Edit row in "${table}"`} maxWidth={560}>
      <p className={styles.helper}>
        {primaryKey.map((pk) => `${pk} = ${toInput(row[pk])}`).join(", ")}
      </p>

      <div className={styles.editForm}>
        {editable.map((c) => (
          <label key={c} className={styles.editField}>
            <span className={styles.editLabel}>{c}</span>
            <input
              className={styles.editInput}
              value={form[c]}
              onChange={(e) => setForm((f) => ({ ...f, [c]: e.target.value }))}
            />
          </label>
        ))}
      </div>

      <p className={styles.helper}>
        Edits are written straight to the row, bypassing the app&apos;s normal validation. Leave a field empty to set it
        to null. Only changed fields are saved.
      </p>

      {error !== null && error !== undefined && (
        <Note tone="bad" icon="!">
          {error instanceof ApiError ? error.message : "Failed to save row."}
        </Note>
      )}

      <ModalActions>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={pending || changed.length === 0}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </ModalActions>
    </Modal>
  );
}
