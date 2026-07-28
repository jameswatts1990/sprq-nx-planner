import type { RunOut, StageOut } from "@/types/schedule";

/**
 * Estimated per-cell stage timing, from PacBio's "Approximate Revio timings" reference and the
 * "Scheduling PPA … with adaptive loading" slide. Each cell runs five stages on a shared axis:
 * prep-pending → prep → movie (acquiring) → PPA-pending → PPA. The instrument is a small machine
 * with limited lanes, and the timeline falls straight out of those limits:
 *
 *  - **Breakout drives everything.** A cell's *breakout* is when its prep starts; its movie
 *    (acquiring) starts `PREP_H` (4h) later, and its 108h reuse window is anchored at breakout.
 *  - **Adaptive loading: cells break out `WELL_STAGGER_H` (2h) apart** within a load group.
 *  - **`SEQ_LANES` (4) sequencing lanes.** A cell holds one of the instrument's 4 physical
 *    positions from its breakout until its movie ends, so a 5th cell (a second tray) can't break
 *    out until the 1st cell's movie finishes — reproducing the slide's second tray starting ~28h
 *    (= 4h prep + 24h movie) after load, not 2h after the fourth cell.
 *  - **`PPA_SERVERS` (2) PPA lanes.** At most two cells are in PPA at once; a cell whose movie
 *    ends while both lanes are busy waits (PPA-pending), giving the slide's ~14h PPA span for 4.
 *
 * Load time is the run's real load/confirm time (each plate anchored at its own
 * `planned_start_at`, so a reuse plate on a later day keeps its offset). These are illustrative
 * estimates: the backend scheduler does not consume them (see docs/pacbio-sprq-nx-scheduling-
 * reference.md, "Per-cell breakout, PPA capacity, and instrument state").
 */
export const PREP_H = 4;
export const WELL_STAGGER_H = 2;
/** Illustrative per-cell post-primary analysis; see PPA_SERVERS for the concurrency limit. */
export const PPA_H = 6;
/** PacBio: an instrument can have at most this many cells in PPA (post-primary analysis) at once. */
export const PPA_SERVERS = 2;
/** The instrument's physical sequencing positions: a cell holds one from breakout to movie end. */
export const SEQ_LANES = 4;
const HOUR_MS = 3_600_000;

export interface StageTiming {
  stage: StageOut;
  /** The run this cell belongs to - lets a multi-run gantt group/divide its rows by run. */
  runId: number;
  /** Start of "prep pending" (the cell is loaded but idle, waiting for a lane / its stagger slot). */
  prepPendingStartH: number;
  /** Breakout = start of prep. The movie starts `PREP_H` later; the 108h window anchors here. */
  prepStartH: number;
  movieStartH: number;
  movieEndH: number;
  ppaStartH: number;
  ppaEndH: number;
  /** Absolute epoch ms (for HH:MM labels). */
  prepPendingStartMs: number;
  prepStartMs: number;
  movieStartMs: number;
  movieEndMs: number;
  ppaStartMs: number;
  ppaEndMs: number;
}

export interface RunTimeline {
  /** T: the timeline's load time as epoch ms — the earliest plate start across the runs shown. */
  loadMs: number;
  /** Total span in hours from T to the last PPA end — the gantt's axis length. */
  spanH: number;
  timings: StageTiming[];
}

interface Seed {
  stage: StageOut;
  runId: number;
  /** Hours from T to this cell's load group's base (its plate's planned_start_at). */
  groupBaseH: number;
  /** Group key: cells loaded together (same plate start) share the SEQ_LANES sequencing lanes. */
  groupKey: string;
  /** Physical position 0-3 (= slot_index % 4) — which of the 4 lanes this cell holds. */
  lane: number;
}

/**
 * Assign breakout / movie times within one load group (cells sharing the 4 sequencing lanes).
 * Cells are taken in slot order; each breaks out at the later of (a) its 2h adaptive-loading slot
 * after the previous cell and (b) when its lane frees (the cell that last held that position
 * finishes its movie). A cell holds its lane from breakout through movie end.
 */
function layoutGroup(seeds: Seed[], loadMs: number): StageTiming[] {
  const ordered = [...seeds].sort((a, b) => a.stage.slot_index - b.stage.slot_index || a.stage.cell_use_id - b.stage.cell_use_id);
  const base = ordered.length ? Math.min(...ordered.map((s) => s.groupBaseH)) : 0;
  const laneFreeH = new Array<number>(SEQ_LANES).fill(base);
  let prevBreakoutH: number | null = null;
  const out: StageTiming[] = [];
  for (const s of ordered) {
    const cadenceFloorH = prevBreakoutH === null ? s.groupBaseH : prevBreakoutH + WELL_STAGGER_H;
    const prepStartH = Math.max(laneFreeH[s.lane], cadenceFloorH);
    const movieStartH = prepStartH + PREP_H;
    const movieEndH = movieStartH + s.stage.run_time_hours;
    laneFreeH[s.lane] = movieEndH;
    prevBreakoutH = prepStartH;
    out.push({
      stage: s.stage,
      runId: s.runId,
      prepPendingStartH: s.groupBaseH,
      prepStartH,
      movieStartH,
      movieEndH,
      // PPA start/end filled by the instrument-wide 2-lane pass (schedulePpa); seed unconstrained.
      ppaStartH: movieEndH,
      ppaEndH: movieEndH + PPA_H,
      prepPendingStartMs: loadMs + s.groupBaseH * HOUR_MS,
      prepStartMs: loadMs + prepStartH * HOUR_MS,
      movieStartMs: loadMs + movieStartH * HOUR_MS,
      movieEndMs: loadMs + movieEndH * HOUR_MS,
      ppaStartMs: loadMs + movieEndH * HOUR_MS,
      ppaEndMs: loadMs + (movieEndH + PPA_H) * HOUR_MS,
    });
  }
  return out;
}

/**
 * Build one estimated timeline across any number of runs on a single shared axis. Time zero is
 * the earliest plate start across all the runs shown. Within each run, cells are grouped by load
 * (plate `planned_start_at`) — cells loaded together share the instrument's 4 sequencing lanes,
 * so a same-session second tray waits ~28h; a reuse plate on a later day is its own group with
 * fresh lanes off its own start. Rows are grouped by run (earliest-loading run first), and within
 * a run by grid slot. Passing a single run degenerates to that run's own timeline.
 */
export function computeTimeline(runs: RunOut[]): RunTimeline {
  const allStarts = runs.flatMap((r) => r.plates.map((p) => Date.parse(p.planned_start_at)));
  const loadMs = allStarts.length ? Math.min(...allStarts) : 0;

  const earliestStart = (r: RunOut) =>
    r.plates.length ? Math.min(...r.plates.map((p) => Date.parse(p.planned_start_at))) : Number.MAX_SAFE_INTEGER;
  const orderedRuns = [...runs].sort((a, b) => earliestStart(a) - earliestStart(b) || a.run_id - b.run_id);

  const timings: StageTiming[] = [];
  for (const run of orderedRuns) {
    // Seed every loaded cell with its load group + lane, then lay out each group independently.
    const groups = new Map<string, Seed[]>();
    for (const plate of run.plates) {
      const groupBaseH = (Date.parse(plate.planned_start_at) - loadMs) / HOUR_MS;
      for (const stage of plate.stages) {
        const seed: Seed = { stage, runId: run.run_id, groupBaseH, groupKey: plate.planned_start_at, lane: stage.slot_index % 4 };
        const list = groups.get(seed.groupKey);
        if (list) list.push(seed);
        else groups.set(seed.groupKey, [seed]);
      }
    }
    const runTimings = [...groups.values()].flatMap((seeds) => layoutGroup(seeds, loadMs));
    // Display order: by grid slot within the run (Plate 1 A-D, then Plate 2 A-D).
    runTimings.sort((a, b) => a.stage.slot_index - b.stage.slot_index || a.stage.cell_use_id - b.stage.cell_use_id);
    timings.push(...runTimings);
  }
  schedulePpa(timings, loadMs);
  const spanH = timings.reduce((m, t) => Math.max(m, t.ppaEndH), 0);
  return { loadMs, spanH, timings };
}

/**
 * Apply the instrument's "only PPA_SERVERS cells in PPA at once" limit across every cell on the
 * shared timeline. Each cell wants PPA the instant its movie ends; if both lanes are busy it
 * waits for the earliest to free (greedy earliest-ready 2-server assignment). Mutates ppa* fields.
 */
function schedulePpa(timings: StageTiming[], loadMs: number): void {
  const order = [...timings].sort((a, b) => a.movieEndH - b.movieEndH || a.prepStartH - b.prepStartH);
  const laneFreeH = new Array<number>(PPA_SERVERS).fill(-Infinity);
  for (const t of order) {
    let lane = 0;
    for (let i = 1; i < laneFreeH.length; i++) if (laneFreeH[i] < laneFreeH[lane]) lane = i;
    const startH = Math.max(t.movieEndH, laneFreeH[lane]);
    laneFreeH[lane] = startH + PPA_H;
    t.ppaStartH = startH;
    t.ppaEndH = startH + PPA_H;
    t.ppaStartMs = loadMs + startH * HOUR_MS;
    t.ppaEndMs = loadMs + t.ppaEndH * HOUR_MS;
  }
}

/** Single-run convenience wrapper around {@link computeTimeline} (the slot-detail popover). */
export function computeRunTimeline(run: RunOut): RunTimeline {
  return computeTimeline([run]);
}
