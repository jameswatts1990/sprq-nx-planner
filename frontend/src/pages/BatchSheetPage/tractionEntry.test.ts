import { describe, expect, it } from "vitest";

import type { SampleDefaults } from "@/api/settings";
import type { BatchSheetPlateOut, BatchSheetRunOut, BatchSheetWellOut } from "@/types/batchSheet";

import { platePositions, runAdaptiveLoading, runReminders, wellIsNonDefault, wellSettingDiffs } from "./tractionEntry";

const DEFAULTS: SampleDefaults = {
  adaptive_loading: "True",
  base_kinetics: "False",
  full_resolution_base_q: "False",
  priority: "Standard (3)",
};

function well(slot: number, overrides: Partial<BatchSheetWellOut> = {}): BatchSheetWellOut {
  return {
    well: "A01",
    slot_index: slot,
    plate_number: slot < 4 ? 1 : 2,
    cell_ref: `C0${(slot % 4) + 1}-T1`,
    use_number: 1,
    cell_max_uses: 3,
    cell_type: "sprq_nx",
    run_time_hours: 24,
    cell_window_deadline: null,
    window_breached: false,
    sample_id: slot + 1,
    sample_pool_id: `TRAC-2-${slot}`,
    plate_id: null,
    barcodes: [],
    adaptive_loading: "True",
    base_kinetics: "False",
    full_resolution_base_q: "False",
    target_oplc: null,
    actual_oplc: 180,
    cleaned_complex_volume: null,
    loading_buffer_volume: null,
    notes: null,
    ...overrides,
  };
}

function plate(plateNumber: 1 | 2, wells: BatchSheetWellOut[]): BatchSheetPlateOut {
  return { plate_number: plateNumber, acquire_date: "2026-10-30", is_reuse: false, movie_hours: 24, wells };
}

function run(plates: BatchSheetPlateOut[]): BatchSheetRunOut {
  return {
    instrument_serial: "84047",
    instrument_name: "Revio 1",
    run_id: 1,
    run_name: null,
    load_date: "2026-10-30",
    status: "planned",
    cell_type: "sprq_nx",
    plates,
  };
}

describe("platePositions", () => {
  it("places wells at A1-D1 by slot, leaving gaps empty", () => {
    const positions = platePositions(plate(1, [well(0), well(2)]));
    expect(positions.map((w) => w?.slot_index ?? null)).toEqual([0, null, 2, null]);
  });

  it("places a reuse Plate 2 (stored loading well A01) by its slot, not its well string", () => {
    const positions = platePositions(plate(2, [well(5, { well: "B01" }), well(4, { well: "A01" })]));
    expect(positions.map((w) => w?.slot_index ?? null)).toEqual([4, 5, null, null]);
  });
});

describe("wellSettingDiffs", () => {
  it("flags only kinetics/baseQ values that differ from the defaults", () => {
    const diffs = wellSettingDiffs(well(0, { base_kinetics: "True" }), DEFAULTS);
    expect(diffs.map((d) => [d.field, d.value])).toEqual([["Include Base Kinetics", "True"]]);
  });

  it("never flags a blank value, or Adaptive Loading (run-level in Traction)", () => {
    const w = well(0, { base_kinetics: null, full_resolution_base_q: null, adaptive_loading: "False" });
    expect(wellSettingDiffs(w, DEFAULTS)).toEqual([]);
  });

  it("flags nothing until the defaults have loaded", () => {
    expect(wellSettingDiffs(well(0, { base_kinetics: "True" }), undefined)).toEqual([]);
  });
});

describe("wellIsNonDefault", () => {
  it("counts a non-default movie time", () => {
    expect(wellIsNonDefault(well(0, { run_time_hours: 30 }), DEFAULTS, 24)).toBe(true);
    expect(wellIsNonDefault(well(0), DEFAULTS, 24)).toBe(false);
  });
});

describe("runAdaptiveLoading", () => {
  it("is uniform when every recorded well agrees, ignoring blanks", () => {
    const r = run([plate(1, [well(0, { adaptive_loading: "False" }), well(1, { adaptive_loading: null })])]);
    expect(runAdaptiveLoading(r)).toEqual({ kind: "uniform", value: "False" });
  });

  it("is mixed when wells disagree, naming each well as Traction labels it", () => {
    const r = run([plate(1, [well(0)]), plate(2, [well(4, { adaptive_loading: "False" })])]);
    expect(runAdaptiveLoading(r)).toEqual({
      kind: "mixed",
      groups: [
        { value: "True", wells: ["P1 A1"] },
        { value: "False", wells: ["P2 A1"] },
      ],
    });
  });

  it("is unknown when no well records it", () => {
    expect(runAdaptiveLoading(run([plate(1, [well(0, { adaptive_loading: null })])]))).toEqual({ kind: "unknown" });
  });
});

describe("runReminders", () => {
  it("is empty for an all-default, fully recorded run", () => {
    expect(runReminders(run([plate(1, [well(0), well(1)])]), DEFAULTS, 24)).toEqual([]);
  });

  it("orders an expired window, then mixed Adaptive Loading, then the info notes", () => {
    const r = run([
      plate(1, [well(0, { window_breached: true }), well(1, { run_time_hours: 30, actual_oplc: null })]),
      plate(2, [well(4, { adaptive_loading: "False" })]),
    ]);
    const reminders = runReminders(r, DEFAULTS, 24);
    expect(reminders.map((n) => n.tone)).toEqual(["bad", "warn", "info", "info"]);
    expect(reminders[0].text).toContain("P1 A1");
    expect(reminders[2].text).toContain("1 well has settings");
    expect(reminders[3].text).toContain("Library Concentration isn't recorded for 1 well (P1 B1)");
  });

  it("tells the user to set a run-wide non-default Adaptive Loading in Well Defaults", () => {
    const r = run([plate(1, [well(0, { adaptive_loading: "False" }), well(1, { adaptive_loading: "False" })])]);
    const [reminder] = runReminders(r, DEFAULTS, 24);
    expect(reminder.tone).toBe("info");
    expect(reminder.text).toContain("Set Use Adaptive Loading to False in Well Defaults");
  });
});
