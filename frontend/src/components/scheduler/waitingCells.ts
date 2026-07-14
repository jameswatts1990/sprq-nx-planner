import type { CellOut } from "@/types/cell";
import { addDaysUTC, isWeekendUTC, parseDateOnly, toIsoDateUTC } from "@/utils/calendarDates";

/** Mirrors backend/app/engine/constants.py's CELL_LIFETIME_H (also duplicated in
 * WindowMeter.tsx) - the single 108h deadline from Use 1, not a per-use timer. */
const CELL_LIFETIME_H = 108;

/** Mirrors the default loading start hour used elsewhere (DAY_START_HOUR on the backend,
 * CellChoicePicker's DEFAULT_START_TIME) - used only as a representative "day start" for
 * comparing a calendar day against a cell's 108h deadline. */
const DAY_START_HOUR = 12;

/** Opacity is ~1.0 (dark/full colour) when a cell has just become eligible and fades
 * toward FADE_MIN_OPACITY (light/washed-out) as it nears the cutoff. Full/near-1.0 at/above
 * FADE_FULL_HOURS-to-go; FADE_MIN_OPACITY at/below FADE_MIN_HOURS-to-go. Tuned for a 108h
 * window run on weekdays only, so the fade has room to show across 2-3 calendar days. */
const FADE_FULL_HOURS = 90;
const FADE_MIN_HOURS = 18;
const FADE_MIN_OPACITY = 0.4;

export interface CellGhost {
  cell: CellOut;
  /** 1-based use number this ghost represents, e.g. 2 for "Use 2". */
  useNumber: number;
  /** The last weekday this cell's next use could still legally start before its 108h
   * window closes. Rendered as a distinct hard-line style, not just the peak of the fade. */
  isHardCutoff: boolean;
  /** ~1.0 (just became eligible, dark/full colour) fading to FADE_MIN_OPACITY (light,
   * approaching the cutoff). Meaningless when isHardCutoff is true (that variant ignores it). */
  fadeOpacity: number;
  /** The actual last calendar day this cell's next use could still start - identical
   * across every ghost rendered for this cell, so the expiry date reads the same
   * regardless of which eligible day is currently on screen. */
  cutoffDate: string;
  /** Exact deadline instant behind cutoffDate, for precise display (e.g. in a popover). */
  deadlineAt: string;
  /** True when Use 1 hasn't been confirmed loaded yet, so deadlineAt/cutoffDate are a
   * provisional estimate from its *planned* loading time, not the real 108h clock (which
   * only starts once a cell is actually removed from the tray - see
   * docs/pacbio-sprq-nx-scheduling-reference.md #2). */
  deadlineIsEstimated: boolean;
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
 * looks. Returns null when the cell isn't an open, idle, previously-used cell, `day` falls
 * outside its reuse window, or the window has already closed. Pure function of
 * already-fetched CellOut data - no "now" dependency, so the same day always renders the
 * same way regardless of when the page happens to be viewed.
 */
export function computeGhost(cell: CellOut, day: string): CellGhost | null {
  if (cell.status !== "open" || cell.uses_remaining <= 0) return null;
  if (cell.uses_consumed <= 0 || !cell.last_use_run_date || !cell.current_instrument_serial) return null;
  if (isWeekendUTC(parseDateOnly(day))) return null;

  const earliestDate = nextWeekdayAfter(cell.last_use_run_date);
  if (day < earliestDate) return null;

  // The 108h clock's real anchor is when Use 1 is actually confirmed loaded
  // (first_use_started_at); until then, fall back to its *planned* loading time as a
  // provisional estimate so a not-yet-confirmed cell still shows a concrete, bounded
  // deadline instead of reading as available indefinitely.
  const deadlineIsEstimated = !cell.first_use_started_at;
  const anchor = cell.first_use_started_at ?? cell.first_use_planned_start_at;
  if (!anchor) return null; // no cycle at all for the first use - shouldn't happen once uses_consumed >= 1

  const deadlineAtMs = new Date(anchor).getTime() + CELL_LIFETIME_H * 3_600_000;
  const thisDayStart = dayStart(day).getTime();
  if (thisDayStart > deadlineAtMs) return null; // already past the cutoff

  // Walk forward from the earliest eligible day to find the actual last qualifying
  // weekday - computed the same way regardless of which day is being rendered, so every
  // ghost for this cell reports the same cutoffDate.
  let cutoffDate = earliestDate;
  while (dayStart(nextWeekdayAfter(cutoffDate)).getTime() <= deadlineAtMs) {
    cutoffDate = nextWeekdayAfter(cutoffDate);
  }
  const isHardCutoff = day === cutoffDate;

  // Dark (full colour) when far from the deadline, fading toward light as it approaches.
  const hoursToDeadline = (deadlineAtMs - thisDayStart) / 3_600_000;
  const clamped = Math.min(FADE_FULL_HOURS, Math.max(FADE_MIN_HOURS, hoursToDeadline));
  const fadeOpacity =
    FADE_MIN_OPACITY + ((clamped - FADE_MIN_HOURS) / (FADE_FULL_HOURS - FADE_MIN_HOURS)) * (1 - FADE_MIN_OPACITY);

  return {
    cell,
    useNumber: cell.uses_consumed + 1,
    isHardCutoff,
    fadeOpacity,
    cutoffDate,
    deadlineAt: new Date(deadlineAtMs).toISOString(),
    deadlineIsEstimated,
  };
}

/** Mirrors backend/app/engine/constants.py's WELLS - tray 1 is indices 0-3, tray 2 is
 * 4-7. Used only to sort ghosts back into the physical tray order their cells last
 * occupied, since the cells API's own ordering (newest-first) doesn't reflect that. */
const WELL_ORDER = ["A01", "B01", "C01", "D01", "A02", "B02", "C02", "D02"];

function wellSortKey(well: string | null): number {
  const i = well ? WELL_ORDER.indexOf(well) : -1;
  return i === -1 ? WELL_ORDER.length : i;
}

/**
 * Buckets every open, idle, reusable cell's ghost(s) by (current instrument, day) across
 * the visible window - mirrors groupCyclesByInstrumentAndDay's shape so the grid can look
 * ghosts up the same way it looks up real cycles.
 */
export function groupWaitingCellsByInstrumentAndDay(cells: CellOut[], days: string[]): Map<string, Map<string, CellGhost[]>> {
  const byInstrument = new Map<string, Map<string, CellGhost[]>>();

  // Sort by the well each cell was last removed from, so ghosts reappear in the same
  // top-to-bottom tray order the samples were actually loaded in last time, rather than
  // in the cells API's newest-first order.
  const orderedCells = [...cells].sort((a, b) => wellSortKey(a.current_well) - wellSortKey(b.current_well));

  for (const cell of orderedCells) {
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
