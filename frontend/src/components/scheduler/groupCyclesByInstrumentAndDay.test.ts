import { describe, expect, it } from "vitest";

import type { CycleOut, StageOut } from "@/types/schedule";

import { isCellOpen } from "./groupCyclesByInstrumentAndDay";

function baseStage(overrides: Partial<StageOut> = {}): StageOut {
  return {
    slot_index: 0,
    well: "A01",
    cell_use_id: 10,
    cell_id: 100,
    cell_ref: "CELL-000100",
    use_number: 1,
    sample_id: 1,
    sample_external_id: "SAMPLE-1",
    barcodes: [],
    cell_use_status: "planned",
    cell_status: "open",
    tray_position: 1,
    tray_id: null,
    window_hours_elapsed: null,
    ...overrides,
  };
}

function baseCycle(overrides: Partial<CycleOut> = {}): CycleOut {
  return {
    cycle_id: 1,
    instrument_serial: "84047",
    run_date: "2026-07-20",
    movie_hours: 24,
    status: "planned",
    planned_start_at: "2026-07-20T09:00:00Z",
    planned_end_at: "2026-07-21T09:00:00Z",
    actual_start_at: null,
    actual_end_at: null,
    lock_until: "2026-07-20T15:00:00Z",
    is_locked: false,
    stages: [],
    ...overrides,
  };
}

describe("isCellOpen", () => {
  it("is open when no cycle exists yet and no carry-over lock applies", () => {
    expect(isCellOpen(undefined, undefined)).toBe(true);
  });

  it("is open when the cycle has no stages at all", () => {
    expect(isCellOpen(baseCycle({ stages: [] }), undefined)).toBe(true);
  });

  it("is NOT open when the cycle has a real planned stage", () => {
    expect(isCellOpen(baseCycle({ stages: [baseStage({ cell_use_status: "planned" })] }), undefined)).toBe(false);
  });

  it("is open when every stage is a cancelled stopped-cell marker", () => {
    const cycle = baseCycle({
      stages: [
        baseStage({ cell_use_id: 10, cell_use_status: "cancelled" }),
        baseStage({ cell_use_id: 11, slot_index: 1, well: "B01", cell_use_status: "cancelled" }),
      ],
    });
    expect(isCellOpen(cycle, undefined)).toBe(true);
  });

  it("is NOT open when a cancelled marker sits alongside a real placement", () => {
    const cycle = baseCycle({
      stages: [
        baseStage({ cell_use_id: 10, cell_use_status: "cancelled" }),
        baseStage({ cell_use_id: 12, slot_index: 1, well: "B01", cell_use_status: "planned" }),
      ],
    });
    expect(isCellOpen(cycle, undefined)).toBe(false);
  });

  it("is NOT open when the only stage recorded a real QC outcome (failed/aborted/completed/started)", () => {
    for (const status of ["failed", "aborted", "completed", "started"]) {
      expect(isCellOpen(baseCycle({ stages: [baseStage({ cell_use_status: status })] }), undefined)).toBe(false);
    }
  });

  it("is NOT open when no cycle exists yet but an earlier run's lock still carries over", () => {
    const carryOverLock = baseCycle({ cycle_id: 2, run_date: "2026-07-17", lock_until: "2026-07-21T18:00:00Z" });
    expect(isCellOpen(undefined, carryOverLock)).toBe(false);
  });
});
