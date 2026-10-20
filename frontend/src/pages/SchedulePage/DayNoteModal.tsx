import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { ApiError } from "@/api/client";
import { scheduleNotesApi } from "@/api/scheduleNotes";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import type { InstrumentOut } from "@/types/instrument";
import type { ScheduleNoteOut } from "@/types/scheduleNote";
import { formatShortDateUTC, parseDateOnly, shortWeekdayUTC } from "@/utils/calendarDates";

import styles from "./DayNoteModal.module.css";

// Mirrors the backend cap (schedule_note_service.MAX_BODY_LEN).
const MAX_BODY_LEN = 500;

export interface DayNoteModalProps {
  /** The day the note sits on (fixed once created). */
  date: string;
  /** The note being edited, or null to add a new one. */
  note: ScheduleNoteOut | null;
  /** Active instruments in grid order, already loaded by the Schedule page. */
  instruments: InstrumentOut[];
  onClose: () => void;
}

/** Add or edit a day note: its text plus which instruments it shows on. Opened from a day
 * header's "+ Note" (add) or by clicking a note banner in the grid (edit / delete). */
export function DayNoteModal({ date, note, instruments, onClose }: DayNoteModalProps) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState(note?.body ?? "");
  const [selected, setSelected] = useState<Set<number>>(() => new Set(note?.instrument_ids ?? []));

  const onDone = () => {
    queryClient.invalidateQueries({ queryKey: ["schedule-notes"] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => {
      const req = { body, instrument_ids: [...selected] };
      return note ? scheduleNotesApi.update(note.id, req) : scheduleNotesApi.create({ ...req, note_date: date });
    },
    onSuccess: onDone,
  });
  const remove = useMutation({
    mutationFn: () => scheduleNotesApi.del(note!.id),
    onSuccess: onDone,
  });
  const pending = save.isPending || remove.isPending;
  const error = save.error ?? remove.error;

  const allSelected = instruments.length > 0 && instruments.every((i) => selected.has(i.id));
  const someSelected = instruments.some((i) => selected.has(i.id));
  const allRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(instruments.map((i) => i.id)));
  }

  const blank = body.trim() === "";
  const d = parseDateOnly(date);
  const dayLabel = `${shortWeekdayUTC(d)} ${formatShortDateUTC(d)}`;
  const pinnedCount = note?.instrument_ids.length ?? 0;

  return (
    <Modal onClose={pending ? () => {} : onClose} title={`${note ? "Edit note" : "Add note"} · ${dayLabel}`}>
      <p className={styles.intro}>
        Shows as a banner at the top of this day for each instrument you tick. Everyone sees it; it doesn&apos;t change
        the schedule.
      </p>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="day-note-body">
          Note
        </label>
        <textarea
          id="day-note-body"
          className={styles.textarea}
          value={body}
          maxLength={MAX_BODY_LEN}
          onChange={(e) => setBody(e.target.value)}
          placeholder="e.g. Engineer visit — don't load before 14:00"
          autoFocus
        />
        <span className={styles.counter}>
          {body.length}/{MAX_BODY_LEN}
        </span>
      </div>

      <fieldset className={styles.choices}>
        <legend className={styles.label}>Instruments</legend>
        <label className={`${styles.choice} ${styles.allChoice}`}>
          <input ref={allRef} type="checkbox" checked={allSelected} onChange={toggleAll} />
          <span className={styles.choiceMain}>All instruments</span>
        </label>
        {instruments.map((i) => (
          <label key={i.id} className={styles.choice}>
            <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
            <span className={styles.choiceMain}>
              {i.name || i.serial_number}
              {i.name && <span className={styles.meta}>{i.serial_number}</span>}
            </span>
          </label>
        ))}
      </fieldset>
      {note && selected.size === 0 && (
        <p className={styles.hint}>Tick at least one instrument — or delete the note instead.</p>
      )}

      {error != null && (
        <Note tone="bad" icon="!">
          {error instanceof ApiError ? error.message : "Failed to save the note."}
        </Note>
      )}

      <ModalActions>
        {note && (
          <Button
            variant="danger"
            className={styles.deleteBtn}
            onClick={() => remove.mutate()}
            disabled={pending}
            title="Delete this note from every instrument it's on"
          >
            {remove.isPending ? "Deleting…" : pinnedCount > 1 ? `Delete from all ${pinnedCount}` : "Delete note"}
          </Button>
        )}
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => save.mutate()} disabled={pending || blank || selected.size === 0}>
          {save.isPending ? "Saving…" : note ? "Save note" : "Add note"}
        </Button>
      </ModalActions>
    </Modal>
  );
}
