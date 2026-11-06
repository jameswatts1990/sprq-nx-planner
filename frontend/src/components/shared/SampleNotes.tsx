import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, useCallback, useMemo, useState } from "react";

import { errorMessage } from "@/api/client";
import { samplesApi } from "@/api/samples";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";

import { NoteIcon } from "./icons";
import styles from "./SampleNotes.module.css";

/** A sample's free-text note (SampleOut.notes): the chip + ✎ that sit under a Pool ID in a list,
 * the note row that drops open below it, and the in-place editor. Notes save through
 * samplesApi.updateNotes, which works at any status - a failed sample awaiting resupply too. */

export interface NoteRowState {
  /** The note is showing in its row below the sample. */
  open: boolean;
  /** The editor is showing in that row instead. */
  editing: boolean;
}
const CLOSED: NoteRowState = { open: false, editing: false };

/** Each row's note state in a sample table, keyed by row id (two rows can be the same sample).
 * The table renders a note row under row `key` while `stateOf(key)` is open or editing. */
export function useNoteRows() {
  const [rows, setRows] = useState<ReadonlyMap<number, NoteRowState>>(() => new Map());
  const update = useCallback(
    (key: number, next: (s: NoteRowState) => NoteRowState) =>
      setRows((prev) => new Map(prev).set(key, next(prev.get(key) ?? CLOSED))),
    [],
  );
  /** The chip: show the note, or close it (and any open editor). */
  const toggle = useCallback((key: number) => update(key, (s) => ({ open: !(s.open || s.editing), editing: false })), [update]);
  /** The ✎: open the editor in the note row. */
  const edit = useCallback((key: number) => update(key, (s) => ({ ...s, editing: true })), [update]);
  /** The editor closed: on save, show the saved note (or close the row if it was cleared); on
   * cancel (`saved` undefined), go back to how the row was before ✎. */
  const done = useCallback(
    (key: number, saved?: string | null) => update(key, (s) => ({ open: saved === undefined ? s.open : !!saved, editing: false })),
    [update],
  );
  // Memoized so a table's column memo only rebuilds when a note opens, closes or starts editing.
  return useMemo(() => ({ stateOf: (key: number) => rows.get(key) ?? CLOSED, toggle, edit, done }), [rows, toggle, edit, done]);
}

/** Under a sample's Pool ID: a chip (▸ + note icon + the note's first words) that drops the note
 * open in a row below, and a ✎ to edit it there. With no note, `allowAdd` shows a quiet
 * "✎ Add note" instead; otherwise nothing renders. */
export function SampleNoteControls({
  notes,
  state,
  onToggle,
  onEdit,
  allowAdd = false,
}: {
  notes: string | null;
  state: NoteRowState;
  onToggle: () => void;
  onEdit: () => void;
  allowAdd?: boolean;
}) {
  if (!notes) {
    if (!allowAdd || state.editing) return null;
    return (
      <button type="button" className={styles.add} onClick={onEdit}>
        <span aria-hidden="true">✎</span> Add note
      </button>
    );
  }
  const open = state.open || state.editing;
  return (
    <span className={styles.controls}>
      <button
        type="button"
        className={styles.chip}
        aria-expanded={open}
        aria-label={open ? "Hide note" : `Show note: ${notes}`}
        title={open ? "Hide note" : notes}
        onClick={onToggle}
      >
        <span className={open ? "disclosure open" : "disclosure"} aria-hidden="true">
          ▸
        </span>
        <NoteIcon />
        {/* Closed: a one-line preview. Open: the full note is right below, so just "Note". */}
        <span className={styles.preview}>{open ? "Note" : notes}</span>
      </button>
      <Button size="sm" variant="ghost" icon aria-label="Edit note" title="Edit note" onClick={onEdit}>
        ✎
      </Button>
    </span>
  );
}

/** What a sample table's note row shows: the editor while editing, else the full note. */
export function SampleNotePanel({
  sampleId,
  notes,
  editing,
  onDone,
}: {
  sampleId: number;
  notes: string | null;
  editing: boolean;
  onDone: (saved?: string | null) => void;
}) {
  if (editing) return <SampleNoteEditor sampleId={sampleId} notes={notes} onDone={onDone} />;
  return <p className={styles.text}>{notes}</p>;
}

/** A sample's note as a labelled-page field: the full note (or "No note") with a ✎ to edit it in
 * place. For the sample's own page, where there's room to always show it. */
export function SampleNoteField({ sampleId, notes }: { sampleId: number; notes: string | null }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <SampleNoteEditor sampleId={sampleId} notes={notes} onDone={() => setEditing(false)} />;
  return (
    <div className={styles.field}>
      {notes ? <p className={styles.text}>{notes}</p> : <span className={styles.empty}>No note</span>}
      <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
        ✎ {notes ? "Edit note" : "Add note"}
      </Button>
    </div>
  );
}

/** Textarea + Save/Cancel (Ctrl/⌘+Enter saves, Esc cancels). Saving a blank note clears it. On a
 * failed save it stays open with the error, so the text isn't lost. */
function SampleNoteEditor({
  sampleId,
  notes,
  onDone,
}: {
  sampleId: number;
  notes: string | null;
  onDone: (saved?: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(notes ?? "");
  const mutation = useMutation({
    mutationFn: () => samplesApi.updateNotes(sampleId, draft),
    // The note shows on the Backlog's lists, its resupply list and the sample's own page. Close
    // the editor only once they've refetched, so the row never flashes the old note.
    onSuccess: async (sample) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["samples"] }),
        queryClient.invalidateQueries({ queryKey: ["sample", sampleId] }),
        queryClient.invalidateQueries({ queryKey: ["topups"] }),
      ]);
      onDone(sample.notes);
    },
  });
  const unchanged = draft.trim() === (notes ?? "");

  function save() {
    if (!unchanged && !mutation.isPending) mutation.mutate();
  }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
    if (e.key === "Escape") onDone();
  }
  // Focus once on open with the caret after the existing text, ready to add to it.
  const focusAtEnd = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  return (
    <div className={styles.editor}>
      <textarea
        ref={focusAtEnd}
        className={styles.textarea}
        rows={3}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Add a note about this sample…"
        aria-label="Sample note"
      />
      <div className={styles.editorActions}>
        <span className={styles.hint}>Ctrl+Enter to save · Esc to cancel</span>
        <Button size="sm" variant="ghost" onClick={() => onDone()} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={save} disabled={unchanged || mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save note"}
        </Button>
      </div>
      {mutation.isError && (
        <Note tone="bad" icon="!" size="sm">
          {errorMessage(mutation.error, "Couldn't save the note.")}
        </Note>
      )}
    </div>
  );
}
