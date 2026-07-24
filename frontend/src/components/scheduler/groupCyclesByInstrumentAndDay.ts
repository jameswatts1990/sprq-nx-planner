import type { RunOut, StageOut } from "@/types/schedule";
import { parseDateOnly } from "@/utils/calendarDates";

import { SLOT_INDICES } from "./gridKeys";

/** Longest possible lock span is 30h movie + 6h buffer per plate, and a reuse run's Plate 2
 * acquires a day after loading - so a run can still be occupying its instrument up to two
 * calendar days after its load_date. Widen the runs fetch window by this many days (see
 * SchedulePage) so continuation markers are visible even when their origin run's load day
 * isn't itself in the visible window. */
export const LOCK_LOOKBACK_DAYS = 2;

/** Every filled-well stage of a run, flattened across its 1-2 plates. The run's plates hold
 * only their own filled wells; the grid renders from a length-8 pad (see padStages). */
export function allStages(run: RunOut): StageOut[] {
  return run.plates.flatMap((p) => p.stages);
}

/**
 * Groups runs by (instrument_serial, load_date) for grid-cell placement. Exactly one run per
 * (instrument, load day) - the run is the load session that day. Any (instrument, date) pair
 * with no entry is a fully-empty grid cell.
 */
export function groupCyclesByInstrumentAndDay(runs: RunOut[]): Map<string, Map<string, RunOut>> {
  const byInstrument = new Map<string, Map<string, RunOut>>();

  for (const run of runs) {
    let byDate = byInstrument.get(run.instrument_serial);
    if (!byDate) {
      byDate = new Map();
      byInstrument.set(run.instrument_serial, byDate);
    }
    byDate.set(run.load_date, run);
  }

  return byInstrument;
}

/**
 * A day column with no run of its own that an *earlier* run on the same instrument is still
 * occupying: either one of that run's plates acquires exactly on this day (a reuse Plate 2 the
 * instrument runs itself the day after loading) OR its lock still spans this day (a long movie
 * bleeding past). Rendered as a lightweight, non-interactive continuation marker (see
 * SchedulerDayCell). `acquiresToday` distinguishes the "Plate 2 acquiring here" case (no action
 * needed - the instrument runs it) from a bare lock carry-over.
 */
export interface Continuation {
  run: RunOut;
  /** A plate of the earlier run acquires exactly on this day (reuse Plate 2), vs only a
   * lock-until carry-over. */
  acquiresToday: boolean;
}

/**
 * Whether a grid cell is open for selection/placement: no run exists yet, or one exists but
 * has no *active* stages, AND no continuation from an earlier run still occupies the day (see
 * findContinuation). A day with no run of its own can still be physically closed if the
 * instrument is running an earlier run's later plate, or is still locked. A stage-less run can
 * happen when every stage gets removed (normally the backend deletes the now-empty run too,
 * but a concurrent bulk removal can race and leave one behind). A cancelled-only run happens
 * when a cell was Stopped before its planned use ran: that stage is kept forever as a
 * permanent marker, occupying one well while the rest stays genuinely empty.
 */
export function isCellOpen(run: RunOut | undefined, continuation: Continuation | undefined): boolean {
  if (continuation !== undefined) return false;
  return run === undefined || allStages(run).every((s) => s.cell_use_status === "cancelled");
}

/**
 * Expands a run's sparse plate stages (only filled wells, across both plates) into a fixed
 * length-8 array indexed by slot_index (Plate 1 -> 0-3, Plate 2 -> 4-7), with `null` for empty
 * slots - the shape the two-plate grid cell renders from.
 */
export function padStages(run: RunOut | undefined): (StageOut | null)[] {
  const slots: (StageOut | null)[] = SLOT_INDICES.map(() => null);
  if (run) {
    for (const stage of allStages(run)) {
      if (SLOT_INDICES.includes(stage.slot_index)) slots[stage.slot_index] = stage;
    }
  }
  return slots;
}

/**
 * For a day with no run of its own, finds the earlier run on this instrument that still
 * occupies it - either one of its plates acquires exactly on `day` (a reuse Plate 2), or its
 * lock hasn't elapsed by the start of `day`. Prefers an acquiring run (the more informative
 * "the instrument is running Plate 2 here" case) over a bare lock carry-over, and the
 * latest-locking candidate when several qualify equally. `runsByDate` must include runs from
 * before the visible window (see LOCK_LOOKBACK_DAYS) so it sees runs loaded outside it.
 */
export function findContinuation(runsByDate: Map<string, RunOut>, day: string): Continuation | undefined {
  const dayStart = parseDateOnly(day).getTime();
  // A bare lock (no plate acquiring here) only *closes* a day it spans in full. If the
  // instrument frees up partway through this day (the lock ends before the day is out), the
  // day is still loadable - a new run can be created that day, starting when the lock clears
  // (see backend instrument_lock.resolve_new_run_start). So compare against the end of the
  // day, not its start: a lock ending at 18:00 on this day no longer carries over onto it.
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  let best: { run: RunOut; acquiresToday: boolean; lockUntil: number } | undefined;
  for (const run of runsByDate.values()) {
    if (run.load_date >= day) continue; // only an earlier run can carry over
    const acquiresToday = run.plates.some((p) => p.acquire_date === day);
    const lockUntil = new Date(run.lock_until).getTime();
    if (!acquiresToday && lockUntil <= dayEnd) continue; // frees up by end of day, or not locking here
    if (!best) {
      best = { run, acquiresToday, lockUntil };
    } else if (acquiresToday && !best.acquiresToday) {
      best = { run, acquiresToday, lockUntil }; // an acquiring continuation beats a bare lock
    } else if (acquiresToday === best.acquiresToday && lockUntil > best.lockUntil) {
      best = { run, acquiresToday, lockUntil };
    }
  }
  return best ? { run: best.run, acquiresToday: best.acquiresToday } : undefined;
}
