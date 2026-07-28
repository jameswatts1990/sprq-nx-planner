import { describe, expect, it } from "vitest";

import type { PlateOut, RunOut, StageOut } from "@/types/schedule";

import { computeRunTimeline, computeTimeline, PPA_H, PREP_H, WELL_STAGGER_H } from "./stageTimings";

function stage(slotIndex: number, runTimeHours: 12 | 24 | 30, cellUseId: number): StageOut {
  return {
    slot_index: slotIndex as StageOut["slot_index"],
    well: "A01",
    cell_use_id: cellUseId,
    cell_id: cellUseId,
    cell_ref: `CELL-${cellUseId}`,
    cell_home_well: "A01",
    use_number: 1,
    run_time_hours: runTimeHours,
    sample_id: cellUseId,
    sample_external_id: `S${cellUseId}`,
    barcodes: [],
    cell_use_status: "planned",
    cell_status: "open",
    cell_has_failed_use: false,
    tray_position: (slotIndex % 4) + 1,
    tray_id: 1,
    window_hours_elapsed: null,
    notes: null,
  };
}

function plate(plateIndex: 1 | 2, startIso: string, stages: StageOut[]): PlateOut {
  return {
    plate_id: plateIndex,
    plate_index: plateIndex,
    acquire_date: startIso.slice(0, 10),
    is_reuse: false,
    movie_hours: Math.max(...stages.map((s) => s.run_time_hours)),
    status: "planned",
    planned_start_at: startIso,
    planned_end_at: startIso,
    actual_start_at: null,
    actual_end_at: null,
    stages,
  };
}

function run(plates: PlateOut[]): RunOut {
  return {
    run_id: 1,
    instrument_serial: "84047",
    load_date: plates[0].acquire_date,
    run_name: null,
    status: "planned",
    lock_until: plates[0].planned_start_at,
    is_locked: false,
    plates,
  };
}

describe("computeRunTimeline", () => {
  it("staggers wells 2h apart, movie 4h after prep, per the reference image", () => {
    const r = run([plate(1, "2026-08-03T12:00:00+00:00", [stage(0, 24, 10), stage(1, 24, 11)])]);
    const { timings, spanH } = computeRunTimeline(r);

    const s0 = timings.find((t) => t.stage.cell_use_id === 10)!;
    expect(s0.prepStartH).toBe(0);
    expect(s0.movieStartH).toBe(PREP_H); // 4
    expect(s0.movieEndH).toBe(PREP_H + 24); // 28
    expect(s0.ppaStartH).toBe(PREP_H + 24); // PPA starts as the movie ends
    expect(s0.ppaEndH).toBe(PREP_H + 24 + PPA_H); // 34

    const s1 = timings.find((t) => t.stage.cell_use_id === 11)!;
    expect(s1.prepStartH).toBe(WELL_STAGGER_H); // 2
    expect(s1.movieStartH).toBe(WELL_STAGGER_H + PREP_H); // 6
    expect(s1.movieEndH).toBe(WELL_STAGGER_H + PREP_H + 24); // 30
    expect(s1.ppaEndH).toBe(WELL_STAGGER_H + PREP_H + 24 + PPA_H); // 36

    // Span now runs to the last well's PPA tail, not its movie end.
    expect(spanH).toBe(36);
  });

  it("anchors a later plate at its own real start offset from the load time", () => {
    // Plate 2 planned a full day after Plate 1 (a reuse plate) - its well's prep starts at
    // that 24h offset, not at 0.
    const r = run([
      plate(1, "2026-08-03T12:00:00+00:00", [stage(0, 24, 10)]),
      plate(2, "2026-08-04T12:00:00+00:00", [stage(4, 12, 20)]),
    ]);
    const { timings } = computeRunTimeline(r);
    const s = timings.find((t) => t.stage.cell_use_id === 20)!;
    expect(s.prepStartH).toBe(24); // plate-2 offset + (4 % 4)*stagger
    expect(s.movieStartH).toBe(24 + PREP_H);
    expect(s.movieEndH).toBe(24 + PREP_H + 12);
    expect(s.ppaEndH).toBe(24 + PREP_H + 12 + PPA_H);
  });
});

describe("computeTimeline (multiple runs)", () => {
  it("lays overlapping runs on one shared axis, grouped earliest-run-first", () => {
    // Two runs on one instrument: run B loads 6h after run A, so they overlap (A still
    // sequencing when B starts). Together they'd be up to 8 cells on one gantt.
    const runA: RunOut = { ...run([plate(1, "2026-08-03T12:00:00+00:00", [stage(0, 24, 10)])]), run_id: 1 };
    const runB: RunOut = { ...run([plate(1, "2026-08-03T18:00:00+00:00", [stage(0, 24, 20)])]), run_id: 2 };

    // Pass out of order to prove ordering is by load time, not input order.
    const { loadMs, spanH, timings } = computeTimeline([runB, runA]);

    // Shared time zero is the earliest load across both runs (run A at 12:00).
    expect(loadMs).toBe(Date.parse("2026-08-03T12:00:00+00:00"));
    // Rows grouped by run, earliest-loading run first.
    expect(timings.map((t) => t.runId)).toEqual([1, 2]);

    const a = timings.find((t) => t.stage.cell_use_id === 10)!;
    const b = timings.find((t) => t.stage.cell_use_id === 20)!;
    expect(a.prepStartH).toBe(0);
    expect(b.prepStartH).toBe(6); // run B's 6h-later load shifts its whole block right
    expect(b.movieEndH).toBe(6 + PREP_H + 24);
    // The span runs to the latest PPA tail across both runs (run B's).
    expect(spanH).toBe(6 + PREP_H + 24 + PPA_H);
  });
});

describe("sequencing lanes (second tray waits for the first to free the instrument)", () => {
  it("breaks tray 1 out 2h apart and tray 2 only once a lane frees (~28h), per the adaptive-loading slide", () => {
    // One same-session 8-cell run: Plate 1 (slots 0-3) and a parallel Plate 2 (slots 4-7) loaded
    // together. All four sequencing lanes are held by Plate 1 until its movies end.
    const start = "2026-08-03T12:00:00+00:00";
    const r = run([
      plate(1, start, [stage(0, 24, 100), stage(1, 24, 101), stage(2, 24, 102), stage(3, 24, 103)]),
      plate(2, start, [stage(4, 24, 104), stage(5, 24, 105), stage(6, 24, 106), stage(7, 24, 107)]),
    ]);
    const { timings } = computeRunTimeline(r);
    const breakout = (id: number) => timings.find((t) => t.stage.cell_use_id === id)!.prepStartH;

    // Tray 1: 2h adaptive-loading stagger from load.
    expect([breakout(100), breakout(101), breakout(102), breakout(103)]).toEqual([0, 2, 4, 6]);
    // Tray 2: each cell waits for its lane (tray-1 movie ends at 28/30/32/34), so it breaks out
    // ~28h after load, not 2h after tray 1 - the slide's second-tray cadence.
    expect([breakout(104), breakout(105), breakout(106), breakout(107)]).toEqual([28, 30, 32, 34]);
    // Movie (acquiring) starts PREP_H after breakout.
    expect(timings.find((t) => t.stage.cell_use_id === 104)!.movieStartH).toBe(28 + PREP_H);
  });
});

describe("PPA capacity (only 2 cells in PPA at once)", () => {
  it("delays cells 3 & 4 until a PPA lane frees, giving the reference ~14h PPA span", () => {
    // A full tray of four 24h cells, 2h-staggered. Movies end at 28/30/32/34h.
    const r = run([
      plate(1, "2026-08-03T12:00:00+00:00", [stage(0, 24, 10), stage(1, 24, 11), stage(2, 24, 12), stage(3, 24, 13)]),
    ]);
    const { timings, spanH } = computeRunTimeline(r);
    const byId = (id: number) => timings.find((t) => t.stage.cell_use_id === id)!;

    // Cells 1 & 2 start PPA the moment their movie ends (both lanes free).
    expect(byId(10).ppaStartH).toBe(28);
    expect(byId(11).ppaStartH).toBe(30);
    // Cell 3's movie ends at 32 but both lanes are busy until 34 (cell 1 frees) - it waits ~2h.
    expect(byId(12).movieEndH).toBe(32);
    expect(byId(12).ppaStartH).toBe(34);
    // Cell 4's movie ends at 34; the next lane frees at 36 (cell 2) - it waits ~2h too.
    expect(byId(13).movieEndH).toBe(34);
    expect(byId(13).ppaStartH).toBe(36);
    // Total PPA runs 28h → 42h = ~14h across the tray, matching the reference slide.
    expect(byId(13).ppaEndH).toBe(42);
    expect(spanH).toBe(42);
  });
});
