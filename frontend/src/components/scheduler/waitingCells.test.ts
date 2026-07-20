import { describe, expect, it } from "vitest";

import type { CellOut } from "@/types/cell";

import {
  computeGhost,
  computePendingTerminalGhost,
  computeTerminalGhost,
  computeUnusedTraySiblingGhost,
  computeVacatedTrayIds,
  groupWaitingCellsByInstrumentAndDay,
} from "./waitingCells";

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
    discarded_reason: null,
    discarded_at: null,
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

  it("returns null on weekends only - no start-date gate", () => {
    expect(computeUnusedTraySiblingGhost(baseUnusedTraySibling(), "2026-07-11")).toBeNull(); // Saturday
    // A sample can legitimately be scheduled onto a weekday earlier in the visible week
    // than the tray's own real-world created_at (e.g. placing onto Monday's slot from a
    // Thursday) - this must NOT hide the sibling on those earlier days.
    expect(computeUnusedTraySiblingGhost(baseUnusedTraySibling(), "2026-07-10")).not.toBeNull();
  });

  it("shows on every weekday, with no fade, cutoff, or expiry", () => {
    const cell = baseUnusedTraySibling();
    const earlier = computeUnusedTraySiblingGhost(cell, "2026-07-06");
    const later = computeUnusedTraySiblingGhost(cell, "2026-08-03");

    expect(earlier?.unused).toBe(true);
    expect(earlier?.isHardCutoff).toBe(false);
    expect(earlier?.fadeOpacity).toBe(1);
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

describe("computeVacatedTrayIds", () => {
  it("excludes a tray where any sibling is still open", () => {
    const exhausted = baseCell({ id: 1, tray_id: 1, status: "exhausted" });
    const stillOpen = baseUnusedTraySibling({ id: 2, tray_id: 1, status: "open" });

    expect(computeVacatedTrayIds([exhausted, stillOpen]).has(1)).toBe(false);
  });

  it("includes a tray once every sibling has gone terminal or stopped", () => {
    const exhausted = baseCell({ id: 1, tray_id: 2, status: "exhausted" });
    const expired = baseCell({ id: 2, tray_id: 2, status: "window_expired" });
    const retired = baseCell({ id: 3, tray_id: 2, status: "retired" });
    const stopped = baseCell({ id: 4, tray_id: 2, status: "stopped" });

    expect(computeVacatedTrayIds([exhausted, expired, retired, stopped]).has(2)).toBe(true);
  });

  it("ignores cells with no tray_id", () => {
    const untracked = baseCell({ id: 1, tray_id: null, status: "exhausted" });

    expect(computeVacatedTrayIds([untracked]).size).toBe(0);
  });
});

describe("computeTerminalGhost's vacated-tray gating", () => {
  it("still shows the marker while a sibling in the same tray is still open", () => {
    const exhausted = baseCell({ id: 1, tray_id: 3, status: "exhausted" });
    const vacatedTrayIds = computeVacatedTrayIds([
      exhausted,
      baseUnusedTraySibling({ id: 2, tray_id: 3, status: "open" }),
    ]);

    expect(computeTerminalGhost(exhausted, "2026-07-14", vacatedTrayIds)?.terminalStatus).toBe("exhausted");
  });

  it("returns null (no marker at all) once the whole tray has gone terminal", () => {
    const exhausted = baseCell({ id: 1, tray_id: 4, status: "exhausted" });
    const expired = baseCell({ id: 2, tray_id: 4, status: "window_expired" });
    const vacatedTrayIds = computeVacatedTrayIds([exhausted, expired]);

    expect(computeTerminalGhost(exhausted, "2026-07-14", vacatedTrayIds)).toBeNull();
  });

  it("returns null immediately for a cell with no tray_id, since it has no siblings to wait on", () => {
    const untracked = baseCell({ id: 1, tray_id: null, status: "retired" });
    expect(computeTerminalGhost(untracked, "2026-07-14")).toBeNull();
  });

  it("still shows the marker for a tray-linked cell when vacatedTrayIds is omitted (defaults to empty)", () => {
    const trayLinked = baseCell({ id: 2, tray_id: 5, status: "retired" });
    expect(computeTerminalGhost(trayLinked, "2026-07-14")?.terminalStatus).toBe("retired");
  });
});

describe("computePendingTerminalGhost / computeTerminalGhost's day-gating", () => {
  it("shows pending (not terminal) between an exhausted cell's own real placements, terminal only after the last one", () => {
    // Every use already scheduled up front for Mon 07-13 / Wed 07-15 / Fri 07-17 - the
    // aggregate status has already flipped to exhausted since there's no capacity left to
    // schedule, even though only the Monday use has actually happened yet. tray_id is set
    // (with no vacatedTrayIds passed below, so it reads as not-yet-vacated) purely so this
    // test's own day-gating is exercised in isolation from vacated-tray gating, which is
    // covered separately above.
    const cell = baseCell({
      status: "exhausted",
      uses_consumed: 3,
      uses_remaining: 0,
      last_use_run_date: "2026-07-17",
      tray_id: 20,
    });

    // Tuesday - the locked day between Monday's and Wednesday's real placements.
    expect(computeTerminalGhost(cell, "2026-07-14")).toBeNull();
    const tue = computePendingTerminalGhost(cell, "2026-07-14");
    expect(tue?.pendingTerminalStatus).toBe("exhausted");
    expect(tue?.useNumber).toBe(3);

    // Thursday - between Wednesday's and Friday's real placements, still not yet terminal.
    expect(computeTerminalGhost(cell, "2026-07-16")).toBeNull();
    expect(computePendingTerminalGhost(cell, "2026-07-16")).not.toBeNull();

    // The following Monday, after the actual last use (Friday) - now genuinely terminal.
    expect(computePendingTerminalGhost(cell, "2026-07-20")).toBeNull();
    expect(computeTerminalGhost(cell, "2026-07-20")?.terminalStatus).toBe("exhausted");
  });

  it("gates window_expired on the actual 108h deadline, not last_use_run_date", () => {
    // Use 1 confirmed loaded Monday 07-13 12:00 UTC -> real deadline Saturday 07-18 00:00 UTC
    // (same math as computeGhost's own deadline tests). Only one use ever happened before
    // the window closed. tray_id set for the same isolation-from-vacated-gating reason as
    // the test above.
    const cell = baseCell({
      status: "window_expired",
      uses_consumed: 1,
      uses_remaining: 2,
      last_use_run_date: "2026-07-13",
      first_use_started_at: "2026-07-13T12:00:00Z",
      tray_id: 21,
    });

    // Wednesday - after last_use_run_date, but well before the 108h deadline actually closes.
    expect(computeTerminalGhost(cell, "2026-07-15")).toBeNull();
    expect(computePendingTerminalGhost(cell, "2026-07-15")?.pendingTerminalStatus).toBe("window_expired");

    // The following Monday - well after the deadline closed.
    expect(computePendingTerminalGhost(cell, "2026-07-20")).toBeNull();
    expect(computeTerminalGhost(cell, "2026-07-20")?.terminalStatus).toBe("window_expired");
  });

  it("never gates retired - it has no scheduling-driven boundary, so it stays terminal on every visible weekday", () => {
    // tray_id set for the same isolation-from-vacated-gating reason as the tests above.
    const cell = baseCell({ status: "retired", last_use_run_date: "2026-07-17", tray_id: 22 });
    expect(computeTerminalGhost(cell, "2026-07-14")?.terminalStatus).toBe("retired");
    expect(computePendingTerminalGhost(cell, "2026-07-14")).toBeNull();
  });
});
