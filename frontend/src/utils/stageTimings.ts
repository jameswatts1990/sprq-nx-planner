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
  /** Hours from the run's load time (T); well 1 of plate 1 preps at 0. */
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
  /** T: the run's load time (plate 1's planned start) as epoch ms. */
  loadMs: number;
  /** Total span in hours from T to the last movie end — the gantt's axis length. */
  spanH: number;
  timings: StageTiming[];
}

/**
 * Build the estimated timeline for every loaded well of a run. Time zero is the run's load
 * time (plate 1's `planned_start_at`); a later plate (a reuse Plate 2 on another day, or a
 * second tray) keeps its own real start offset so the gantt spans the whole run. Stages are
 * returned sorted by grid slot so the rows read Plate 1 (A–D) then Plate 2 (A–D).
 */
export function computeRunTimeline(run: RunOut): RunTimeline {
  const plate1 = run.plates.find((p) => p.plate_index === 1);
  const allStarts = run.plates.map((p) => Date.parse(p.planned_start_at));
  const loadMs = plate1 ? Date.parse(plate1.planned_start_at) : allStarts.length ? Math.min(...allStarts) : 0;

  const timings: StageTiming[] = [];
  for (const plate of run.plates) {
    const plateOffsetH = (Date.parse(plate.planned_start_at) - loadMs) / HOUR_MS;
    for (const stage of plate.stages) {
      const withinPos = stage.slot_index % 4; // A/B/C/D position inside the plate's tray
      const prepStartH = plateOffsetH + withinPos * WELL_STAGGER_H;
      const movieStartH = prepStartH + PREP_H;
      const movieEndH = movieStartH + stage.run_time_hours;
      const ppaStartH = movieEndH;
      const ppaEndH = ppaStartH + PPA_H;
      timings.push({
        stage,
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
  timings.sort(
    (a, b) => a.stage.slot_index - b.stage.slot_index || a.stage.cell_use_id - b.stage.cell_use_id,
  );
  const spanH = timings.reduce((m, t) => Math.max(m, t.ppaEndH), 0);
  return { loadMs, spanH, timings };
}
