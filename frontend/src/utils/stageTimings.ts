import type { PlateOut, RunOut, StageOut } from "@/types/schedule";

/**
 * Estimated per-cell stage timing, from PacBio's "Approximate Revio timings" reference and the
 * "Scheduling PPA … with adaptive loading" slide. Each cell runs five stages on a shared axis:
 * prep-pending → prep → movie (acquiring) → PPA-pending → PPA. The instrument is a small machine
 * with limited lanes, and the timeline falls straight out of those limits:
 *
 *  - **Breakout drives everything.** A cell's *breakout* is when its prep starts; its movie
 *    (acquiring) starts `PREP_H` (4h) later — plus `REUSE_PREP_H` (the 45-min on-board wash) for a
 *    Use 2/3 cell, whose prep is 4h 45m (it's already in the instrument, so a reuse's turnaround is
 *    the wash, not a fresh tray breakout). Its 108h reuse window is anchored at breakout.
 *  - **Adaptive loading: cells break out `WELL_STAGGER_H` (2h) apart** within a load group.
 *  - **`SEQ_LANES` (4) sequencing lanes.** A cell holds one of the instrument's 4 physical
 *    positions from its breakout until its movie ends, so a 5th cell (a second tray) can't break
 *    out until the 1st cell's movie finishes — reproducing the slide's second tray starting ~28h
 *    (= 4h prep + 24h movie) after load, not 2h after the fourth cell.
 *  - **`PPA_SERVERS` (2) PPA lanes.** At most two cells are in PPA at once; a cell whose movie
 *    ends while both lanes are busy waits (PPA-pending), giving the slide's ~14h PPA span for 4.
 *
 * Load time is the run's real load time: each plate is anchored at its own `actual_start_at`
 * once the run is running (the time entered at Confirm loaded), falling back to `planned_start_at`
 * while it's still planned — so a loaded run's bars and live line sit on when it *actually*
 * started, and a reuse plate on a later day keeps its offset. This matches the backend's
 * `cell_timing._plate_anchor`, so the gantt agrees with the "Active now"/instrument live-state.
 * These are illustrative estimates: the backend scheduler does not consume them (see
 * docs/pacbio-sprq-nx-scheduling-reference.md, "Per-cell breakout, PPA capacity, and instrument state").
 */
export const PREP_H = 4;
/**
 * On-board reuse wash added to a Use 2/3 cell's prep (45 min). PacBio's Revio v13.5 multi-use
 * workflow adds ~45 min to cell prep for each reuse vs a single-use cell. Mirrors backend
 * `cell_timing.REUSE_PREP_H` / `engine.constants.REUSE_PREP_H`; a reuse (`use_number >= 2`) preps
 * for `PREP_H + REUSE_PREP_H`.
 */
export const REUSE_PREP_H = 0.75;
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
  /** Hours from T to this cell's load group's base (its plate's effective anchor). */
  groupBaseH: number;
  /** Group key = one loading session (run + plate start): its cells share the 2h prep stagger. */
  groupKey: string;
}

/**
 * Schedule every cell across all the given runs on ONE shared set of `SEQ_LANES` (4) sequencing
 * servers — the instrument's real limit, shared *across runs*. A cell takes the earliest-free
 * server and holds it from breakout to movie end, so a run loaded while the machine is busy has
 * its cells pushed to when a server frees (cross-run contention). The 2h adaptive-loading prep
 * stagger is per load group (`groupKey` = one loading session), so separate loads don't chain
 * their prep off each other. Mirrors backend `cell_timing.compute_timings`; PPA is applied after
 * by the global 2-server pass (`schedulePpa`).
 */
function schedule4Server(seeds: Seed[], loadMs: number): StageTiming[] {
  const ordered = [...seeds].sort(
    (a, b) => a.groupBaseH - b.groupBaseH || a.stage.slot_index - b.stage.slot_index || a.stage.cell_use_id - b.stage.cell_use_id,
  );
  const base0 = ordered.length ? Math.min(...ordered.map((s) => s.groupBaseH)) : 0;
  const servers = new Array<number>(SEQ_LANES).fill(base0); // earliest-free time of each of the 4 servers
  const prevBreakoutH = new Map<string, number>(); // last breakout per load group -> the 2h prep-stagger floor
  const out: StageTiming[] = [];
  for (const s of ordered) {
    const staggerFloorH = prevBreakoutH.has(s.groupKey) ? prevBreakoutH.get(s.groupKey)! + WELL_STAGGER_H : s.groupBaseH;
    let i = 0;
    for (let j = 1; j < servers.length; j++) if (servers[j] < servers[i]) i = j; // earliest-free server
    const prepStartH = Math.max(staggerFloorH, servers[i]);
    // Prep is PREP_H for a first use; a reuse (Use 2/3) adds the REUSE_PREP_H on-board wash on top.
    const movieStartH = prepStartH + PREP_H + (s.stage.use_number >= 2 ? REUSE_PREP_H : 0);
    const movieEndH = movieStartH + s.stage.run_time_hours;
    servers[i] = movieEndH;
    prevBreakoutH.set(s.groupKey, prepStartH);
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
 * A plate's effective load anchor (epoch ms): its real confirm-load time (`actual_start_at`, set
 * once the plate is running) when known, else its planned start. "Loading time = the time entered
 * at Confirm loaded", so a loaded run's gantt keys off the real load while a still-planned run
 * (e.g. the slot-detail preview) keys off the plan. Mirrors backend `cell_timing._plate_anchor`.
 */
function plateAnchorMs(plate: PlateOut): number {
  return Date.parse(plate.actual_start_at ?? plate.planned_start_at);
}

/**
 * Build one estimated timeline across any number of runs on a single shared axis. Time zero is
 * the earliest plate anchor across all the runs shown. Every cell across every run is scheduled
 * through ONE shared set of 4 sequencing servers (see `schedule4Server`): cells loaded together
 * share the 2h prep stagger, and a run loaded while the instrument is busy has its cells pushed
 * to when a server frees — so passing an instrument's whole resident run set shows real cross-run
 * contention (a same-session second tray waits ~28h; a fresh run loaded over a busy machine waits
 * for a lane). Rows are grouped by run (earliest-loading run first), within a run by grid slot.
 * Passing a single run degenerates to that run's own timeline.
 */
export function computeTimeline(runs: RunOut[]): RunTimeline {
  const allStarts = runs.flatMap((r) => r.plates.map((p) => plateAnchorMs(p)));
  const loadMs = allStarts.length ? Math.min(...allStarts) : 0;

  // Seed every loaded cell across every run, then schedule them all through the shared servers.
  // groupKey = `${run}:${plate start}` ties the 2h prep stagger to one loading session while the
  // sequencing servers stay shared across the whole instrument.
  const seeds: Seed[] = [];
  for (const run of runs) {
    for (const plate of run.plates) {
      const groupBaseH = (plateAnchorMs(plate) - loadMs) / HOUR_MS;
      for (const stage of plate.stages) {
        seeds.push({ stage, runId: run.run_id, groupBaseH, groupKey: `${run.run_id}:${plate.planned_start_at}` });
      }
    }
  }
  const timings = schedule4Server(seeds, loadMs);
  schedulePpa(timings, loadMs);

  // Display order: rows grouped by run (earliest-loading run first), within a run by grid slot,
  // so the gantt's per-run divider (newGroup) reads cleanly.
  const earliestStart = (r: RunOut) =>
    r.plates.length ? Math.min(...r.plates.map((p) => plateAnchorMs(p))) : Number.MAX_SAFE_INTEGER;
  const runOrder = new Map<number, number>();
  [...runs]
    .sort((a, b) => earliestStart(a) - earliestStart(b) || a.run_id - b.run_id)
    .forEach((r, i) => runOrder.set(r.run_id, i));
  timings.sort(
    (a, b) =>
      (runOrder.get(a.runId) ?? 0) - (runOrder.get(b.runId) ?? 0) ||
      a.stage.slot_index - b.stage.slot_index ||
      a.stage.cell_use_id - b.stage.cell_use_id,
  );

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
