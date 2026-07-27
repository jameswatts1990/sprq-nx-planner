import { describe, expect, it } from "vitest";

import type { PlateOut, RunOut, StageOut } from "@/types/schedule";

import { computeRunTimeline, PPA_H, PREP_H, WELL_STAGGER_H } from "./stageTimings";

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
