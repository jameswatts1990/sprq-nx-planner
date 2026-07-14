import type { CycleOut, StageOut } from "@/types/schedule";
import { parseDateOnly } from "@/utils/calendarDates";

import { SLOT_INDICES } from "./gridKeys";

/** Longest possible lock span is 30h movie + 6h buffer = 36h, so a run can still be
 * locking its instrument up to two calendar days later - widen the cycles fetch window
 * by this many days (see SchedulePage) so carry-over locks are visible even when their
 * origin run's day isn't itself in the visible window. */
export const LOCK_LOOKBACK_DAYS = 2;

/**
 * Groups cycles by (instrument_serial, run_date) for grid-cell placement. Analogous to
 * the old calendar's groupCyclesByInstrumentAndDay, but keyed by the absolute run_date
 * string instead of a relative day_idx, and holding a single CycleOut per cell (the new
 * model has exactly one cycle per instrument+day). Any (instrument, date) pair with no
 * entry is a fully-empty grid cell.
 */
export function groupCyclesByInstrumentAndDay(cycles: CycleOut[]): Map<string, Map<string, CycleOut>> {
  const byInstrument = new Map<string, Map<string, CycleOut>>();

  for (const cycle of cycles) {
    let byDate = byInstrument.get(cycle.instrument_serial);
    if (!byDate) {
      byDate = new Map();
      byInstrument.set(cycle.instrument_serial, byDate);
    }
    byDate.set(cycle.run_date, cycle);
  }

  return byInstrument;
}

/**
 * Expands a cycle's sparse `stages` (only filled wells) into a fixed length-8 array
 * indexed by slot_index, with `null` for empty slots - the shape the two-tray grid cell
 * renders from.
 */
export function padStages(cycle: CycleOut | undefined): (StageOut | null)[] {
  const slots: (StageOut | null)[] = SLOT_INDICES.map(() => null);
  if (cycle) {
    for (const stage of cycle.stages) {
      if (SLOT_INDICES.includes(stage.slot_index)) slots[stage.slot_index] = stage;
    }
  }
  return slots;
}

/**
 * For a day with no run of its own, finds the most recent earlier run on this instrument
 * whose lock (movie_hours + LOCK_BUFFER_HOURS from its start) hasn't elapsed by the start
 * of `day` - i.e. it's still "carrying over" a lock onto this otherwise-empty day. Returns
 * the latest-locking candidate if more than one qualifies. `cyclesByDate` must include
 * cycles from before the visible window (see LOCK_LOOKBACK_DAYS) for this to see runs
 * that started outside it.
 */
export function findCarryOverLock(cyclesByDate: Map<string, CycleOut>, day: string): CycleOut | undefined {
  const dayStart = parseDateOnly(day).getTime();
  let latest: CycleOut | undefined;
  for (const cycle of cyclesByDate.values()) {
    if (cycle.run_date >= day) continue; // only an earlier run can carry over
    const lockUntil = new Date(cycle.lock_until).getTime();
    if (lockUntil <= dayStart) continue; // its lock already elapsed before this day starts
    if (!latest || lockUntil > new Date(latest.lock_until).getTime()) latest = cycle;
  }
  return latest;
}
