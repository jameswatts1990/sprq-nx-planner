import { describe, expect, it } from "vitest";

import type { CellOut } from "@/types/cell";

import { countOpenTrays, groupOpenTrayIdsByInstrument } from "./openTrays";

function baseCell(overrides: Partial<CellOut> = {}): CellOut {
  return {
    id: 1,
    code: "CELL-A000001",
    max_uses: 3,
    status: "open",
    uses_consumed: 0,
    uses_remaining: 3,
    burned_barcodes: [],
    window_hours_elapsed: null,
    window_breached: false,
    current_instrument_serial: "84047",
    current_well: "A01",
    last_use_run_date: null,
    first_use_started_at: null,
    first_use_planned_start_at: null,
    created_at: "2026-07-13T12:00:00Z",
    stopped_reason: null,
    stopped_at: null,
    has_failed_use: false,
    needs_qc_report: false,
    awaiting_credit: false,
    pacbio_case_number: null,
    pacbio_reported_at: null,
    pacbio_credit_confirmed_at: null,
    credit_received_at: null,
    discarded_reason: null,
    discarded_at: null,
    tray_id: 1,
    tray_position: 1,
    tray_size: 4,
    ...overrides,
  };
}

describe("groupOpenTrayIdsByInstrument", () => {
  it("excludes cells with no tray_id (pre-feature/bootstrap cells)", () => {
    const grouped = groupOpenTrayIdsByInstrument([baseCell({ tray_id: null })]);
    expect(grouped.size).toBe(0);
  });

  it("dedupes two cells sharing the same tray_id into one entry", () => {
    const grouped = groupOpenTrayIdsByInstrument([
      baseCell({ id: 1, tray_id: 1, tray_position: 1, current_well: "A01" }),
      baseCell({ id: 2, tray_id: 1, tray_position: 2, current_well: "B01" }),
    ]);
    expect(grouped.get("84047")).toEqual([1]);
  });

  it("groups distinct trays from two different instruments into separate entries", () => {
    const grouped = groupOpenTrayIdsByInstrument([
      baseCell({ id: 1, tray_id: 1, current_instrument_serial: "84047" }),
      baseCell({ id: 2, tray_id: 2, current_instrument_serial: "84093" }),
    ]);
    expect(grouped.get("84047")).toEqual([1]);
    expect(grouped.get("84093")).toEqual([2]);
  });

  it("excludes cells with no current_instrument_serial", () => {
    const grouped = groupOpenTrayIdsByInstrument([baseCell({ current_instrument_serial: null })]);
    expect(grouped.size).toBe(0);
  });
});

describe("countOpenTrays", () => {
  it("sums distinct tray counts across every instrument", () => {
    const grouped = new Map([
      ["84047", [1, 2]],
      ["84093", [3]],
    ]);
    expect(countOpenTrays(grouped)).toBe(3);
  });

  it("returns 0 for an empty map", () => {
    expect(countOpenTrays(new Map())).toBe(0);
  });
});
