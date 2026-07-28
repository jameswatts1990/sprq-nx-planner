import type { RunOut, StageOut } from "@/types/schedule";

/**
 * Estimated per-well stage timing, from PacBio's "Approximate Revio timings" reference
 * (the table the lab owner supplied). Each well runs three stages on a shared "hours from
 * load" axis: prep → movie → PPA. Within one plate, each well's prep starts `WELL_STAGGER_H`
 * apart and its movie starts `PREP_H` after that well's own prep start; post-primary analysis
 * (PPA) then runs `PPA_H` once the well's movie ends — e.g. cell 1: prep T+0, movie T+4, PPA
 * T+4+run; cell 2: prep T+2, movie T+6, … — with the movie lasting the well's own run time.
 * These are illustrative estimates only: the scheduler's own locks/windows do not consume
 * per-well prep or PPA timing (see docs/pacbio-sprq-nx-scheduling-reference.md, "Instrument
 * load-lock timing"), so anything built on them is labelled "estimated". Each plate is anchored
 * at its real backend `planned_start_at`, so the estimate still tracks the run's actual load
 * time and any reuse-plate day offset.
 */
export const PREP_H = 4;
export const WELL_STAGGER_H = 2;
/**
 * Illustrative per-well post-primary analysis (PPA), running after the well's movie. Derived
 * from the reference's "~14h PPA for 4 SMRT cells (a 2h offset + two 6h units)" ≈ one 6h unit
 * per well — an estimate for the gantt only, never a scheduled/locked duration.
 */
export const PPA_H = 6;
const HOUR_MS = 3_600_000;

export interface StageTiming {
  stage: StageOut;
  /** The run this well belongs to - lets a multi-run gantt group/divide its rows by run. */
  runId: number;
  /** Hours from the timeline's load time (T = the earliest load across the runs shown). */
  prepStartH: number;
  movieStartH: number;
  movieEndH: number;
  ppaStartH: number;
  ppaEndH: number;
  /** Absolute epoch ms (for HH:MM labels). */
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

/**
 * Build one estimated timeline across any number of runs on a single shared axis. Time zero is
 * the earliest plate start across all the runs shown, and every plate keeps its own real start
 * offset (a reuse Plate 2 on another day, a second tray, or a whole second run loaded while the
 * first is still sequencing) so overlapping runs line up on the same clock. Rows are grouped by
 * run (earliest-loading run first), and within a run by grid slot so each run reads Plate 1
 * (A–D) then Plate 2 (A–D). Passing a single run degenerates to that run's own timeline.
 */
export function computeTimeline(runs: RunOut[]): RunTimeline {
  const allStarts = runs.flatMap((r) => r.plates.map((p) => Date.parse(p.planned_start_at)));
  const loadMs = allStarts.length ? Math.min(...allStarts) : 0;

  const earliestStart = (r: RunOut) =>
    r.plates.length ? Math.min(...r.plates.map((p) => Date.parse(p.planned_start_at))) : Number.MAX_SAFE_INTEGER;
  const orderedRuns = [...runs].sort((a, b) => earliestStart(a) - earliestStart(b) || a.run_id - b.run_id);

  const timings: StageTiming[] = [];
  for (const run of orderedRuns) {
    const runTimings: StageTiming[] = [];
    for (const plate of run.plates) {
      const plateOffsetH = (Date.parse(plate.planned_start_at) - loadMs) / HOUR_MS;
      for (const stage of plate.stages) {
        const withinPos = stage.slot_index % 4; // A/B/C/D position inside the plate's tray
        const prepStartH = plateOffsetH + withinPos * WELL_STAGGER_H;
        const movieStartH = prepStartH + PREP_H;
        const movieEndH = movieStartH + stage.run_time_hours;
        const ppaStartH = movieEndH;
        const ppaEndH = ppaStartH + PPA_H;
        runTimings.push({
          stage,
          runId: run.run_id,
          prepStartH,
          movieStartH,
          movieEndH,
          ppaStartH,
          ppaEndH,
          prepStartMs: loadMs + prepStartH * HOUR_MS,
          movieStartMs: loadMs + movieStartH * HOUR_MS,
          movieEndMs: loadMs + movieEndH * HOUR_MS,
          ppaStartMs: loadMs + ppaStartH * HOUR_MS,
          ppaEndMs: loadMs + ppaEndH * HOUR_MS,
        });
      }
    }
    runTimings.sort(
      (a, b) => a.stage.slot_index - b.stage.slot_index || a.stage.cell_use_id - b.stage.cell_use_id,
    );
    timings.push(...runTimings);
  }
  const spanH = timings.reduce((m, t) => Math.max(m, t.ppaEndH), 0);
  return { loadMs, spanH, timings };
}

/** Single-run convenience wrapper around {@link computeTimeline} (the slot-detail popover). */
export function computeRunTimeline(run: RunOut): RunTimeline {
  return computeTimeline([run]);
}
