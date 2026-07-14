import type { CellOut } from "@/types/cell";
import { addDaysUTC, isWeekendUTC, parseDateOnly, toIsoDateUTC } from "@/utils/calendarDates";

/** Mirrors backend/app/engine/constants.py's CELL_LIFETIME_H (also duplicated in
 * WindowMeter.tsx) - the single 108h deadline from Use 1, not a per-use timer. */
const CELL_LIFETIME_H = 108;

/** Mirrors the default loading start hour used elsewhere (DAY_START_HOUR on the backend,
 * CellChoicePicker's DEFAULT_START_TIME) - used only as a representative "day start" for
 * comparing a calendar day against a cell's 108h deadline. */
const DAY_START_HOUR = 12;

/** Full colour at/above this many hours from a given day to the deadline; fully faded
 * (but not yet the hard-cutoff day) at/below this many hours. Tuned for a 108h window run
 * on weekdays only, so the fade has room to show across 2-3 calendar days. */
const FADE_FULL_HOURS = 90;
const FADE_MIN_HOURS = 18;
const FADE_MIN_OPACITY = 0.4;

export interface CellGhost {
  cell: CellOut;
  /** 1-based use number this ghost represents, e.g. 2 for "Use 2". */
  useNumber: number;
  /** The last weekday this cell's next use could still legally start before its 108h
   * window closes. Rendered as a distinct hard-line style, not just the palest fade step. */
  isHardCutoff: boolean;
  /** 1.0 (just became eligible) down to FADE_MIN_OPACITY (approaching the cutoff).
   * Meaningless when isHardCutoff is true. */
  fadeOpacity: number;
}

function nextWeekdayAfter(isoDate: string): string {
  let d = addDaysUTC(parseDateOnly(isoDate), 1);
  while (isWeekendUTC(d)) d = addDaysUTC(d, 1);
  return toIsoDateUTC(d);
}

function dayStart(isoDate: string): Date {
  const d = parseDateOnly(isoDate);
  d.setUTCHours(DAY_START_HOUR, 0, 0, 0);
  return d;
}

/**
 * Whether `cell` is waiting to be reused on `day` (a weekday), and if so, how urgent that
 * looks. Returns null when the cell isn't an open, idle, previously-used cell, or `day`
 * falls outside its reuse window. Pure function of already-fetched CellOut data - no
 * "now" dependency, so the same day always renders the same way regardless of when the
 * page happens to be viewed.
 */
export function computeGhost(cell: CellOut, day: string): CellGhost | null {
  if (cell.status !== "open" || cell.uses_remaining <= 0) return null;
  if (cell.uses_consumed <= 0 || !cell.last_use_run_date || !cell.current_instrument_serial) return null;
  if (isWeekendUTC(parseDateOnly(day))) return null;

  const earliestDate = nextWeekdayAfter(cell.last_use_run_date);
  if (day < earliestDate) return null;

  const useNumber = cell.uses_consumed + 1;

  if (!cell.first_use_started_at) {
    // Window clock hasn't started (Use 1 hasn't been confirmed loaded yet) - no known
    // deadline, so show a flat, un-faded "available" ghost with no urgency framing.
    return { cell, useNumber, isHardCutoff: false, fadeOpacity: 1 };
  }

  const deadlineAt = new Date(cell.first_use_started_at).getTime() + CELL_LIFETIME_H * 3_600_000;
  const thisDayStart = dayStart(day).getTime();
  if (thisDayStart > deadlineAt) return null; // already past the cutoff

  const nextDayStart = dayStart(nextWeekdayAfter(day)).getTime();
  const isHardCutoff = nextDayStart > deadlineAt;

  const hoursToDeadline = (deadlineAt - thisDayStart) / 3_600_000;
  const clamped = Math.min(FADE_FULL_HOURS, Math.max(FADE_MIN_HOURS, hoursToDeadline));
  const fadeOpacity =
    FADE_MIN_OPACITY + ((clamped - FADE_MIN_HOURS) / (FADE_FULL_HOURS - FADE_MIN_HOURS)) * (1 - FADE_MIN_OPACITY);

  return { cell, useNumber, isHardCutoff, fadeOpacity };
}

/**
 * Buckets every open, idle, reusable cell's ghost(s) by (current instrument, day) across
 * the visible window - mirrors groupCyclesByInstrumentAndDay's shape so the grid can look
 * ghosts up the same way it looks up real cycles.
 */
export function groupWaitingCellsByInstrumentAndDay(cells: CellOut[], days: string[]): Map<string, Map<string, CellGhost[]>> {
  const byInstrument = new Map<string, Map<string, CellGhost[]>>();

  for (const cell of cells) {
    if (!cell.current_instrument_serial) continue;
    for (const day of days) {
      const ghost = computeGhost(cell, day);
      if (!ghost) continue;

      let byDate = byInstrument.get(cell.current_instrument_serial);
      if (!byDate) {
        byDate = new Map();
        byInstrument.set(cell.current_instrument_serial, byDate);
      }
      const list = byDate.get(day);
      if (list) list.push(ghost);
      else byDate.set(day, [ghost]);
    }
  }

  return byInstrument;
}
