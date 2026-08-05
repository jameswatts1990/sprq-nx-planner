/**
 * Pure timing/layout helpers for the instrument "Week plan" view (WeekPlanGantt/WeekPlanModal).
 * Sits beside stageTimings.ts the same way that file sits beside RunStageGantt: the per-cell
 * stage math stays in stageTimings.computeTimeline; everything here is about re-projecting that
 * output onto a FIXED calendar week (rather than stageTimings' own auto-fit span) and deriving
 * the two whole-instrument summary bands ("loading window" / "noisy") from it.
 */
import { formatShortDateUTC, shortWeekdayUTC } from "@/utils/calendarDates";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

/**
 * How many days before the visible Monday to over-fetch runs, so a run loaded before the week
 * but still sequencing/in PPA into it renders correctly (truncated), not missing. Deliberately
 * NOT the grid's LOCK_LOOKBACK_DAYS=2 (groupCyclesByInstrumentAndDay.ts) - that constant is
 * calibrated for the much shorter loading-lock window (run_load_lock_end). Hand-traced against
 * schedule4Server/schedulePpa for the worst case this app allows - a same-session two-tray (8
 * cell) run at the longest movie length (30h) - the loading lock clears at 44h, but the last
 * cell's PPA doesn't end until 82h (~3.4 days), since PPA queues behind the sequencing-lane wait
 * on top of its own 2-lane cap. 4 days covers that with margin.
 */
export const WEEK_PLAN_LOOKBACK_DAYS = 4;

export interface ShadedInterval {
  startMs: number;
  endMs: number;
}

/** Sorts and sweeps a set of spans into their union, merging any that overlap or touch - callers
 *  shade the result, so an unmerged overlap would double up opacity at the seam. */
export function mergeIntervals(spans: ShadedInterval[]): ShadedInterval[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a.startMs - b.startMs);
  const merged: ShadedInterval[] = [{ ...sorted[0] }];
  for (const span of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (span.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, span.endMs);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/** One run's per-run inputs to the loading-window band - a subset of StageTiming so tests don't
 *  need a full stage/run fixture just to exercise this aggregation. */
export type LoadWindowInput = { runId: number; prepPendingStartMs: number; movieStartMs: number };

/**
 * The "loading window" summary band: shaded wherever the instrument is committed to a run and
 * can't yet accept a fresh load. For each run this is [its load time, its LAST cell's prep-done
 * time] - exactly cell_timing.run_load_lock_end's rule (the instrument frees to load a new run
 * the instant the run's last cell finishes prep). Everywhere else on the axis is implicitly
 * "open" - the caller doesn't need a separate "open" list, only the closed one.
 */
export function computeLoadingWindowBands(timings: LoadWindowInput[]): ShadedInterval[] {
  const byRun = new Map<number, LoadWindowInput[]>();
  for (const t of timings) {
    const list = byRun.get(t.runId);
    if (list) list.push(t);
    else byRun.set(t.runId, [t]);
  }
  const perRun: ShadedInterval[] = [];
  for (const stages of byRun.values()) {
    perRun.push({
      startMs: Math.min(...stages.map((s) => s.prepPendingStartMs)),
      endMs: Math.max(...stages.map((s) => s.movieStartMs)),
    });
  }
  return mergeIntervals(perRun);
}

/** A stage's PPA inputs to the noisy band - a subset of StageTiming, see LoadWindowInput. */
export type NoisyInput = { ppaStartMs: number; ppaEndMs: number };

/**
 * The "noisy" summary band: PPA is a whole-instrument resource (only PPA_SERVERS cells at once),
 * so this is the union of every stage's own PPA span regardless of which run it belongs to -
 * unlike the loading window, this is never grouped per-run first.
 */
export function computeNoisyBands(timings: NoisyInput[]): ShadedInterval[] {
  return mergeIntervals(timings.map((t) => ({ startMs: t.ppaStartMs, endMs: t.ppaEndMs })));
}

export interface ClippedSpan {
  leftPct: number;
  widthPct: number;
}

/**
 * Projects an absolute [startMs, endMs) span onto the fixed week axis as a left%/width% pair,
 * truncating whatever part falls outside [weekStartMs, weekEndMs) rather than dropping or
 * mispositioning it - a run loaded before the visible week (still sequencing/in PPA into it) or
 * one running past Sunday still reads as "still going" at the clipped edge. Clamping the
 * TIMESTAMPS first, then converting to percent, is what guarantees the result always lands in
 * [0, 100] - computing a raw percent and clamping left/width afterwards can't be trusted the
 * same way. Returns null when the span doesn't intersect the week at all.
 */
export function clipToWeek(
  startMs: number,
  endMs: number,
  weekStartMs: number,
  weekEndMs: number,
): ClippedSpan | null {
  const s = Math.max(startMs, weekStartMs);
  const e = Math.min(endMs, weekEndMs);
  if (e <= s) return null;
  const weekSpan = weekEndMs - weekStartMs;
  return {
    leftPct: ((s - weekStartMs) / weekSpan) * 100,
    widthPct: ((e - s) / weekSpan) * 100,
  };
}

/**
 * Keeps only the stages that intersect the visible week at all, for both the per-cell rows and
 * the two summary bands to share - so nothing can disagree about what's "in view". A stage's 5
 * sub-phases (prep-pending -> prep -> movie -> PPA-pending -> PPA) are monotonically ordered
 * with no gaps, so testing just the outer envelope (first phase start, last phase end) is
 * sufficient to decide whether any part of it falls inside the week.
 */
export function filterVisibleTimings<T extends { prepPendingStartMs: number; ppaEndMs: number }>(
  timings: T[],
  weekStartMs: number,
  weekEndMs: number,
): T[] {
  return timings.filter((t) => t.prepPendingStartMs < weekEndMs && t.ppaEndMs > weekStartMs);
}

export interface DayMark {
  ms: number;
  label: string;
}

/** The week's 7 day-boundary marks (label positions for the day header) - a fixed calendar
 *  structure, unlike RunStageGantt's buildAxisTicks, which adapts its step to an arbitrary span. */
export function buildWeekDayMarks(weekStartMs: number): DayMark[] {
  return Array.from({ length: 7 }, (_, i) => {
    const ms = weekStartMs + i * DAY_MS;
    const d = new Date(ms);
    return { ms, label: `${shortWeekdayUTC(d)} ${formatShortDateUTC(d)}` };
  });
}
