import type { ScheduleNoteMove, ScheduleNoteOut } from "@/types/scheduleNote";

/** Client-side mirror of schedule_note_service.move_note, so a dropped banner lands at once
 * instead of snapping back until the server answers: the whole note takes the new day, and the
 * target instrument takes the dragged row's place (a merge when the note is already there).
 * The server's response replaces this as soon as it arrives. */
export function moveNoteLocally(note: ScheduleNoteOut, move: ScheduleNoteMove, toInstrumentId: number): ScheduleNoteOut {
  const pinned = note.instrument_serials
    .map((serial, i) => ({ serial, id: note.instrument_ids[i] }))
    .filter((p) => p.serial !== move.from_instrument_serial);
  if (!pinned.some((p) => p.serial === move.to_instrument_serial)) {
    pinned.push({ serial: move.to_instrument_serial, id: toInstrumentId });
  }
  pinned.sort((a, b) => a.serial.localeCompare(b.serial));
  return {
    ...note,
    note_date: move.note_date,
    instrument_serials: pinned.map((p) => p.serial),
    instrument_ids: pinned.map((p) => p.id),
  };
}

/** The notes list order the backend returns (date, then id), so a moved note stacks where it
 * will after the refetch. */
export function sortNotes(notes: ScheduleNoteOut[]): ScheduleNoteOut[] {
  return [...notes].sort((a, b) => a.note_date.localeCompare(b.note_date) || a.id - b.id);
}
