import { describe, expect, it } from "vitest";

import type { CellOut } from "@/types/cell";

import { computeGhost, computeUnusedTraySiblingGhost, groupWaitingCellsByInstrumentAndDay } from "./waitingCells";

function baseCell(overrides: Partial<CellOut> = {}): CellOut {
  const lastUseRunDate = overrides.last_use_run_date !== undefined ? overrides.last_use_run_date : "2026-07-13";
  return {
    id: 1,
    code: "CELL-000001",
    max_uses: 3,
    status: "open",
    uses_consumed: 1,
    uses_remaining: 2,
    burned_barcodes: [],
    window_hours_elapsed: null,
    window_breached: false,
    current_instrument_serial: "84047",
    current_well: "A01",
    last_use_run_date: lastUseRunDate,
    first_use_started_at: null,
    // Defaults to noon on the same day as last_use_run_date, since in these single-use
    // fixtures the first use *is* the last use - keeps the fixture internally consistent
    // unless a test explicitly overrides one or the other.
    first_use_planned_start_at: lastUseRunDate ? `${lastUseRunDate}T12:00:00Z` : null,
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
    tray_id: null,
    tray_position: null,
    tray_size: 4,
    ...overrides,
  };
}

describe("computeGhost", () => {
  it("returns null for a cell with no uses consumed yet (nothing to wait on)", () => {
    expect(computeGhost(baseCell({ uses_consumed: 0, last_use_run_date: null }), "2026-07-14")).toBeNull();
  });

  it("returns null once the cell is no longer open (exhausted/window_expired/retired)", () => {
    expect(computeGhost(baseCell({ status: "exhausted", uses_remaining: 0 }), "2026-07-14")).toBeNull();
    expect(computeGhost(baseCell({ status: "window_expired" }), "2026-07-14")).toBeNull();
  });

  it("returns null on the same day as the last use and on a weekend, even though it's after last_use_run_date", () => {
    expect(computeGhost(baseCell(), "2026-07-13")).toBeNull(); // same day as last use
    expect(computeGhost(baseCell({ last_use_run_date: "2026-07-10" }), "2026-07-11")).toBeNull(); // Saturday
  });

  it("skips straight to Monday when the last use was a Friday", () => {
    const cell = baseCell({ last_use_run_date: "2026-07-10" }); // Friday
    expect(computeGhost(cell, "2026-07-11")).toBeNull(); // Saturday
    expect(computeGhost(cell, "2026-07-12")).toBeNull(); // Sunday
    expect(computeGhost(cell, "2026-07-13")?.useNumber).toBe(2); // Monday
  });

  it("estimates a bounded deadline from the planned loading time when Use 1 hasn't been confirmed yet", () => {
    // Use 1 planned (not confirmed) for Monday 12:00 UTC -> estimated deadline = +108h = Saturday 00:00 UTC.
    const cell = baseCell({ first_use_started_at: null, first_use_planned_start_at: "2026-07-13T12:00:00Z" });

    const tue = computeGhost(cell, "2026-07-14");
    const fri = computeGhost(cell, "2026-07-17");
    const mon = computeGhost(cell, "2026-07-20");

    expect(tue?.deadlineIsEstimated).toBe(true);
    expect(tue?.cutoffDate).toBe("2026-07-17");
    expect(fri?.isHardCutoff).toBe(true);
    // The estimate still expires - an unconfirmed Use 1 must NOT read as available forever.
    expect(mon).toBeNull();
  });

  it("fades across eligible days and hard-cutoffs on the last one, once Use 1 is confirmed", () => {
    // Use 1 confirmed loaded Monday 12:00 UTC -> deadline = +108h = Saturday 00:00 UTC.
    const cell = baseCell({ first_use_started_at: "2026-07-13T12:00:00Z" });

    const tue = computeGhost(cell, "2026-07-14");
    const wed = computeGhost(cell, "2026-07-15");
    const thu = computeGhost(cell, "2026-07-16");
    const fri = computeGhost(cell, "2026-07-17");
    const mon = computeGhost(cell, "2026-07-20");

    expect(tue?.deadlineIsEstimated).toBe(false);
    // Every ghost for this cell agrees on the same expiry date, regardless of which
    // eligible day is being rendered.
    expect([tue, wed, thu, fri].every((g) => g?.cutoffDate === "2026-07-17")).toBe(true);

    expect(tue?.isHardCutoff).toBe(false);
    expect(wed?.isHardCutoff).toBe(false);
    expect(thu?.isHardCutoff).toBe(false);
    // Friday is the last weekday before the Saturday-midnight deadline - the hard cutoff.
    expect(fri?.isHardCutoff).toBe(true);
    // By the following Monday the window has already closed.
    expect(mon).toBeNull();

    // Opacity fades (decreases) day over day as the deadline approaches: dark/full colour
    // when freshly eligible, light/washed-out near the cutoff.
    expect(tue!.fadeOpacity).toBeGreaterThan(wed!.fadeOpacity);
    expect(wed!.fadeOpacity).toBeGreaterThan(thu!.fadeOpacity);
    expect(thu!.fadeOpacity).toBeGreaterThanOrEqual(0.4);
    expect(tue!.fadeOpacity).toBeLessThanOrEqual(1);
  });
});

function baseUnusedTraySibling(overrides: Partial<CellOut> = {}): CellOut {
  return baseCell({
    uses_consumed: 0,
    uses_remaining: 3,
    last_use_run_date: null,
    first_use_started_at: null,
    first_use_planned_start_at: null,
    created_at: "2026-07-13T12:00:00Z",
    tray_id: 5,
    tray_position: 2,
    current_well: "B01",
    ...overrides,
  });
}

describe("computeUnusedTraySiblingGhost", () => {
  it("returns null for a cell that already has a use (that's computeGhost's job)", () => {
    expect(computeUnusedTraySiblingGhost(baseUnusedTraySibling({ uses_consumed: 1 }), "2026-07-14")).toBeNull();
  });

  it("returns null once the cell is no longer open, or has no known well/instrument yet", () => {
    expect(computeUnusedTraySiblingGhost(baseUnusedTraySibling({ status: "retired" }), "2026-07-14")).toBeNull();
    expect(computeUnusedTraySiblingGhost(baseUnusedTraySibling({ current_well: null }), "2026-07-14")).toBeNull();
    expect(
      computeUnusedTraySiblingGhost(baseUnusedTraySibling({ current_instrument_serial: null }), "2026-07-14"),
    ).toBeNull();
  });

  it("returns null on weekends and on any day before the tray was created", () => {
    expect(computeUnusedTraySiblingGhost(baseUnusedTraySibling(), "2026-07-11")).toBeNull(); // Saturday
    expect(computeUnusedTraySiblingGhost(baseUnusedTraySibling(), "2026-07-10")).toBeNull(); // before created_at
  });

  it("shows on its creation day and every weekday after, with no fade or cutoff", () => {
    const cell = baseUnusedTraySibling();
    const same = computeUnusedTraySiblingGhost(cell, "2026-07-13");
    const later = computeUnusedTraySiblingGhost(cell, "2026-08-03");

    expect(same?.unused).toBe(true);
    expect(same?.isHardCutoff).toBe(false);
    expect(same?.fadeOpacity).toBe(1);
    // Unlike a reuse ghost, there's no clock running yet - it never expires.
    expect(later?.unused).toBe(true);
  });
});

describe("groupWaitingCellsByInstrumentAndDay", () => {
  it("buckets ghosts by the cell's current instrument and each eligible day", () => {
    const cellA = baseCell({ id: 1, current_instrument_serial: "84047", last_use_run_date: "2026-07-13" });
    const cellB = baseCell({ id: 2, current_instrument_serial: "84098", last_use_run_date: "2026-07-13" });
    const days = ["2026-07-13", "2026-07-14", "2026-07-15"];

    const grouped = groupWaitingCellsByInstrumentAndDay([cellA, cellB], days);

    expect(grouped.get("84047")?.get("2026-07-14")?.map((g) => g.cell.id)).toEqual([1]);
    expect(grouped.get("84098")?.get("2026-07-14")?.map((g) => g.cell.id)).toEqual([2]);
    // no ghost on the last-use day itself
    expect(grouped.get("84047")?.get("2026-07-13")).toBeUndefined();
  });

  it("gives a day two ghosts when two different cells on the same instrument both become eligible", () => {
    const cellA = baseCell({ id: 1, current_instrument_serial: "84047", last_use_run_date: "2026-07-13" });
    const cellB = baseCell({ id: 2, current_instrument_serial: "84047", last_use_run_date: "2026-07-13" });

    const grouped = groupWaitingCellsByInstrumentAndDay([cellA, cellB], ["2026-07-14"]);

    expect(grouped.get("84047")?.get("2026-07-14")?.map((g) => g.cell.id).sort()).toEqual([1, 2]);
  });

  it("orders multiple ghosts on the same day by the well their cell was last removed from, not API order", () => {
    // The cells API returns newest-first (created_at desc), which is the opposite of the
    // tray order these cells were actually loaded in last time - the well each was last
    // in (B01, C01, D01) is the only reliable signal of that original order.
    const cellD01 = baseCell({ id: 3, current_instrument_serial: "84047", current_well: "D01", last_use_run_date: "2026-07-13" });
    const cellB01 = baseCell({ id: 1, current_instrument_serial: "84047", current_well: "B01", last_use_run_date: "2026-07-13" });
    const cellC01 = baseCell({ id: 2, current_instrument_serial: "84047", current_well: "C01", last_use_run_date: "2026-07-13" });

    // Passed in newest-first order (3, then 2, then 1), same as the real API response.
    const grouped = groupWaitingCellsByInstrumentAndDay([cellD01, cellC01, cellB01], ["2026-07-14"]);

    expect(grouped.get("84047")?.get("2026-07-14")?.map((g) => g.cell.id)).toEqual([1, 2, 3]);
  });

  it("surfaces an unused tray sibling's reserved ghost alongside a real reuse ghost, same instrument/day", () => {
    const reused = baseCell({ id: 1, current_instrument_serial: "84047", current_well: "A01", last_use_run_date: "2026-07-13" });
    const sibling = baseUnusedTraySibling({ id: 2, current_instrument_serial: "84047", current_well: "B01" });

    const grouped = groupWaitingCellsByInstrumentAndDay([reused, sibling], ["2026-07-14"]);
    const ghosts = grouped.get("84047")?.get("2026-07-14") ?? [];

    expect(ghosts.map((g) => g.cell.id).sort()).toEqual([1, 2]);
    expect(ghosts.find((g) => g.cell.id === 2)?.unused).toBe(true);
    expect(ghosts.find((g) => g.cell.id === 1)?.unused).toBeUndefined();
  });
});
