import { type KeyboardEvent, useState } from "react";

import { ApiError } from "@/api/client";

import { Button } from "./Button";
import styles from "./InlineEditField.module.css";

export interface InlineEditFieldProps {
  label: string;
  /** The saved value; null/empty shows `emptyText`. */
  value: string | null;
  emptyText?: string;
  /** Persist the edited value (already trimmed). Rejections show inline. */
  onSave: (next: string) => Promise<unknown>;
  /** Seeds the editor when the saved value is empty (e.g. the owner name remembered in this browser). */
  suggestion?: string;
  inputType?: "text" | "number";
  maxLength?: number;
  /** May the value be saved blank (clearing it)? A case number can't; an owner can. */
  allowEmpty?: boolean;
  /** Extra validation for the trimmed draft; return a message to block saving. */
  validate?: (draft: string) => string | null;
}

/** A saved value with a ✎ to correct it in place: label + value, then input/Save/Cancel while
 * editing (Enter saves, Escape cancels). For small after-the-fact fixes - a case-number typo, a
 * recount - without a modal. Shows the save error inline and stays open so it can be retried. */
export function InlineEditField({
  label,
  value,
  emptyText = "—",
  onSave,
  suggestion,
  inputType = "text",
  maxLength,
  allowEmpty = false,
  validate,
}: InlineEditFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = draft.trim();
  const invalid = (!allowEmpty && trimmed === "") || (validate ? validate(trimmed) : null);
  const unchanged = trimmed === (value ?? "");

  function start() {
    setDraft(value || suggestion || "");
    setError(null);
    setEditing(true);
  }

  async function save() {
    if (invalid || unchanged || pending) return;
    setPending(true);
    setError(null);
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save.");
    } finally {
      setPending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") void save();
    if (e.key === "Escape") setEditing(false);
  }

  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      {editing ? (
        <>
          <input
            className={styles.input}
            type={inputType}
            min={inputType === "number" ? 1 : undefined}
            value={draft}
            maxLength={maxLength}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label={label}
            autoFocus
          />
          <Button size="sm" variant="primary" onClick={() => void save()} disabled={!!invalid || unchanged || pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
            Cancel
          </Button>
          {(typeof invalid === "string" ? invalid : error) && (
            <span className={styles.error}>{typeof invalid === "string" ? invalid : error}</span>
          )}
        </>
      ) : (
        <>
          <span className={value ? styles.value : styles.empty}>{value || emptyText}</span>
          <button type="button" className={styles.edit} onClick={start} aria-label={`Edit ${label.toLowerCase()}`}>
            ✎
          </button>
        </>
      )}
    </div>
  );
}
