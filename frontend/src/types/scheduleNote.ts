/** A free-text note pinned to one day on one or more instruments, shown as a banner at the top
 * of each of those instrument/day cells in the Schedule grid. Informational only. */
export interface ScheduleNoteOut {
  id: number;
  note_date: string; // ISO date
  body: string;
  instrument_ids: number[];
  // Serials alongside ids: the grid keys its rows by serial.
  instrument_serials: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Edit is a full replace of the text and the instrument set (unticking unpins); the day is fixed. */
export interface ScheduleNoteUpdate {
  body: string;
  instrument_ids: number[];
}

export interface ScheduleNoteCreate extends ScheduleNoteUpdate {
  note_date: string;
}
