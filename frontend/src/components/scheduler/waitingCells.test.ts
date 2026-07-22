import { describe, expect, it } from "vitest";

import type { CellOut } from "@/types/cell";

import type { StageOut } from "@/types/schedule";

import {
  computeBlockedWellsByInstrumentAndDay,
  computeGhost,
  computePendingTerminalGhost,
  computeTerminalGhost,
  computeTrayDisposalWarnings,
  computeTrayFoundingDates,
  computeUnusedTraySiblingGhost,
  computeVacatedTrayIds,
  groupWaitingCellsByInstrumentAndDay,
  pinGhostsToSlots,
} from "./waitingCells";

// Mon-Fri of the visible window used across the tray-level tests below.
const WEEK = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24"];

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

  it("marks a day before this cell's own (not-yet-run) next use as pending-reuse, not a free well", () => {
    // Only 1 of 3 uses consumed - still genuinely "open", not fully booked/terminal - but
    // its one real use is booked for Thursday. Monday, viewed in the same visible week,
    // must not read as an ordinary free "+": this well is already claimed by that Thursday
    // use, even though it hasn't happened yet and the cell still has 2 uses of spare
    // capacity. Regression test for a bug where dropping a different sample onto Monday's
    // slot here silently sent "open a new cell" and the server rejected it as a well
    // collision - the frontend never showed the well was actually taken.
    const cell = baseCell({ uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2026-07-16" }); // Thursday

    const mon = computeGhost(cell, "2026-07-13");
    expect(mon?.pendingReuseStatus).toBe(true);
    expect(mon?.unused).toBeUndefined();
    expect(mon?.terminalStatus).toBeUndefined();
    expect(mon?.pendingTerminalStatus).toBeUndefined();

    // The last-use day itself (Thursday) still renders null here - the real stage covers
    // that day, not a ghost - and Friday onward resumes the ordinary reuse-eligible ghost.
    expect(computeGhost(cell, "2026-07-16")).toBeNull();
    const fri = computeGhost(cell, "2026-07-17");
    expect(fri?.pendingReuseStatus).toBeUndefined();
    expect(fri?.useNumber).toBe(2);
  });

  it("flags pending-reuse ghosts before the tray's own founding day, but keeps them non-null", () => {
    // This tray's actual founding placement was Monday (a sibling cell, not this one) -
    // this cell's own first-ever use (not yet run) is booked for Friday. Tuesday-Thursday
    // must still return the well-reserved ghost (so the well never reads as an ordinary
    // free "+" - same collision-prevention regression as above), but flagged as
    // beforeTrayFounding only for days before the tray's real Monday founding, not this
    // cell's own later Friday use.
    const cell = baseCell({
      tray_id: 9,
      uses_consumed: 1,
      uses_remaining: 2,
      last_use_run_date: "2026-07-17", // Friday
      first_use_started_at: null,
      first_use_planned_start_at: "2026-07-17T12:00:00Z",
    });
    const foundingSibling = baseCell({ id: 99, tray_id: 9, first_use_planned_start_at: "2026-07-13T09:00:00Z" }); // Monday
    const trayFoundingDates = computeTrayFoundingDates([cell, foundingSibling]);

    // Before the tray's real (Monday) founding day - flagged.
    expect(computeGhost(cell, "2026-07-10", trayFoundingDates)?.beforeTrayFounding).toBe(true);

    // On/after the tray's founding day but still before this cell's own Friday use -
    // pending-reuse still applies, but no longer flagged.
    const tue = computeGhost(cell, "2026-07-14", trayFoundingDates);
    expect(tue?.pendingReuseStatus).toBe(true);
    expect(tue?.beforeTrayFounding).toBe(false);

    // With no founding-date data at all (e.g. caller didn't pass the map), behaves exactly
    // as before - never flagged.
    expect(computeGhost(cell, "2026-07-10")?.beforeTrayFounding).toBe(false);
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

  it("flags an unused sibling's ghost before its tray's founding day", () => {
    // The founding cell's first use is scheduled for Friday - its still-unused siblings
    // (this one included) must not read as "Not yet used" on the Monday-Thursday columns,
    // even though eager population already created their Cell rows up front.
    const founding = baseCell({
      id: 1,
      tray_id: 5,
      last_use_run_date: "2026-07-17", // Friday
      first_use_planned_start_at: "2026-07-17T12:00:00Z",
    });
    const trayFoundingDates = computeTrayFoundingDates([founding]);
    const sibling = baseUnusedTraySibling({ id: 2, tray_id: 5 });

    const mon = computeUnusedTraySiblingGhost(sibling, "2026-07-13", trayFoundingDates);
    expect(mon?.unused).toBe(true);
    expect(mon?.beforeTrayFounding).toBe(true);

    const fri = computeUnusedTraySiblingGhost(sibling, "2026-07-17", trayFoundingDates);
    expect(fri?.beforeTrayFounding).toBe(false);
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

  it("flags both a founding cell's own ghost and its unused siblings before the tray's founding day, end to end", () => {
    // A tray's founding cell scheduled for its first-ever use on Friday, with 3 never-used
    // siblings already registered by eager population. Monday-Thursday must flag every one
    // of the tray's ghosts as beforeTrayFounding.
    const founding = baseCell({
      id: 1,
      tray_id: 7,
      current_instrument_serial: "84047",
      current_well: "A02",
      last_use_run_date: "2026-07-17", // Friday
      first_use_started_at: null,
      first_use_planned_start_at: "2026-07-17T12:00:00Z",
    });
    const siblingB = baseUnusedTraySibling({ id: 2, tray_id: 7, current_instrument_serial: "84047", current_well: "B02" });
    const siblingC = baseUnusedTraySibling({ id: 3, tray_id: 7, current_instrument_serial: "84047", current_well: "C02" });
    const siblingD = baseUnusedTraySibling({ id: 4, tray_id: 7, current_instrument_serial: "84047", current_well: "D02" });
    const cells = [founding, siblingB, siblingC, siblingD];
    const trayFoundingDates = computeTrayFoundingDates(cells);

    const monGhosts = groupWaitingCellsByInstrumentAndDay(cells, ["2026-07-13"], new Set(), trayFoundingDates).get(
      "84047",
    )?.get("2026-07-13");
    expect(monGhosts?.length).toBe(4);
    expect(monGhosts?.every((g) => g.beforeTrayFounding)).toBe(true);

    const friGhosts = groupWaitingCellsByInstrumentAndDay(cells, ["2026-07-17"], new Set(), trayFoundingDates).get(
      "84047",
    )?.get("2026-07-17");
    // The founding cell's own real placement isn't a ghost on its own use day (the real
    // stage covers it) - only its 3 still-unused siblings show, and no longer flagged.
    expect(friGhosts?.length).toBe(3);
    expect(friGhosts?.every((g) => !g.beforeTrayFounding)).toBe(true);
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

describe("computeTrayFoundingDates", () => {
  it("takes the earliest first_use_planned_start_at across a tray's cells", () => {
    const founding = baseCell({ id: 1, tray_id: 3, first_use_planned_start_at: "2026-07-15T12:00:00Z" });
    // A sibling that was itself later used (its own first use, on an earlier day than the
    // "founding" cell above happened to get scheduled) - the tray's real founding day is
    // whichever cell actually went first, not necessarily tray_position 1.
    const earlierSibling = baseCell({ id: 2, tray_id: 3, first_use_planned_start_at: "2026-07-13T09:00:00Z" });

    const dates = computeTrayFoundingDates([founding, earlierSibling]);
    expect(dates.get(3)).toBe("2026-07-13");
  });

  it("ignores cells with no tray_id or no first_use_planned_start_at yet", () => {
    const untracked = baseCell({ id: 1, tray_id: null, first_use_planned_start_at: "2026-07-15T12:00:00Z" });
    const neverUsed = baseUnusedTraySibling({ id: 2, tray_id: 4 });

    expect(computeTrayFoundingDates([untracked, neverUsed]).size).toBe(0);
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

describe("pinGhostsToSlots", () => {
  const EMPTY_SLOTS: (StageOut | null)[] = [null, null, null, null, null, null, null, null];

  // The reported bug: two physical trays reuse the same D01 well at different times. Tray A
  // (699) is founded Monday and physically present all week; tray B (703) is a fresh tray
  // auto-scheduled to found on Thursday. On Tuesday, tray A's cell D is still idle and waiting
  // to be reused, so its reuse/expiry ghost must own the D01 slot - not tray B's not-yet-
  // founded sibling, which can't legally be in that well until Thursday.
  function tuesdayGhosts() {
    // Tray A: cell D used once on Monday, now idle and reusable.
    const cellA = baseCell({
      id: 699,
      code: "CELL-D000699",
      tray_id: 1,
      current_well: "D01",
      uses_consumed: 1,
      uses_remaining: 2,
      last_use_run_date: "2026-07-20",
      first_use_planned_start_at: "2026-07-20T12:00:00Z",
    });
    // Tray B: sibling cell D, never used yet, its tray founded Thursday.
    const cellB = baseCell({
      id: 703,
      code: "CELL-D000703",
      tray_id: 2,
      current_well: "D01",
      uses_consumed: 0,
      uses_remaining: 3,
      last_use_run_date: null,
      first_use_planned_start_at: "2026-07-23T12:00:00Z",
    });
    const founding = computeTrayFoundingDates([cellA, cellB]);
    const presentGhost = computeGhost(cellA, "2026-07-21", founding);
    const futureGhost = computeUnusedTraySiblingGhost(cellB, "2026-07-21", founding);
    expect(presentGhost?.beforeTrayFounding).toBeFalsy();
    expect(futureGhost?.beforeTrayFounding).toBe(true);
    return { presentGhost: presentGhost!, futureGhost: futureGhost! };
  }

  it("gives the D01 well to the tray physically present today, not a not-yet-founded tray's sibling", () => {
    const { presentGhost, futureGhost } = tuesdayGhosts();
    // Regardless of input order (the cells API is newest-first, so the future tray's cell
    // often comes first), the present tray's cell must win the slot.
    for (const order of [[futureGhost, presentGhost], [presentGhost, futureGhost]]) {
      const bySlot = pinGhostsToSlots(order, EMPTY_SLOTS);
      expect(bySlot.get(3)?.cell.id).toBe(699);
    }
  });

  it("still pins a lone not-yet-founded ghost when no present tray competes for the well", () => {
    const { futureGhost } = tuesdayGhosts();
    const bySlot = pinGhostsToSlots([futureGhost], EMPTY_SLOTS);
    expect(bySlot.get(3)?.cell.id).toBe(703);
  });

  it("never pins a ghost onto a slot already holding a real placement", () => {
    const { presentGhost } = tuesdayGhosts();
    const slots = [...EMPTY_SLOTS];
    slots[3] = { slot_index: 3 } as StageOut;
    const bySlot = pinGhostsToSlots([presentGhost], slots);
    expect(bySlot.has(3)).toBe(false);
  });
});

describe("computeTrayDisposalWarnings", () => {
  // The reported scenario: tray 1 (A-D) founded Monday. Cells A/B/C were reused Mon-Wed (3
  // uses, exhausted); cell D was used Monday only and then its Tue/Wed uses were moved off,
  // so it's still open with 2 uses left and nothing more scheduled. The tray's last use is
  // Wednesday - after that it's disposed with D's capacity stranded.
  function trayOneCells(): CellOut[] {
    const consumed = (well: string, id: number, code: string) =>
      baseCell({
        id,
        code,
        tray_id: 1,
        current_well: well,
        current_instrument_serial: "84047",
        status: "exhausted",
        uses_consumed: 3,
        uses_remaining: 0,
        last_use_run_date: "2026-07-22", // Wednesday
      });
    return [
      consumed("A01", 696, "CELL-A000696"),
      consumed("B01", 697, "CELL-B000697"),
      consumed("C01", 698, "CELL-C000698"),
      baseCell({
        id: 699,
        code: "CELL-D000699",
        tray_id: 1,
        current_well: "D01",
        current_instrument_serial: "84047",
        status: "open",
        uses_consumed: 1,
        uses_remaining: 2,
        last_use_run_date: "2026-07-20", // Monday - its only remaining scheduled use
      }),
    ];
  }

  it("flags the tray's last-use day with the still-open cell that will be disposed unused", () => {
    const warnings = computeTrayDisposalWarnings(trayOneCells(), WEEK);
    const wed = warnings.get("84047")?.get("2026-07-22");
    expect(wed).toHaveLength(1);
    expect(wed![0]).toMatchObject({ trayId: 1, positionLabel: "Tray 1", wastedUses: 2 });
    expect(wed![0].wastedCells).toEqual([{ code: "CELL-D000699", well: "D01", usesRemaining: 2 }]);
    // Nothing on any other day - it's keyed only to the tray's final scheduled use.
    expect(warnings.get("84047")?.get("2026-07-20")).toBeUndefined();
  });

  it("produces nothing for a fully-consumed tray (no capacity stranded)", () => {
    const cells = trayOneCells().map((c) => ({ ...c, status: "exhausted" as const, uses_remaining: 0 }));
    expect(computeTrayDisposalWarnings(cells, WEEK).size).toBe(0);
  });

  it("produces nothing when the tray's last use falls outside the visible window", () => {
    const cells = trayOneCells().map((c) =>
      c.last_use_run_date === "2026-07-22" ? { ...c, last_use_run_date: "2026-07-29" } : c,
    );
    expect(computeTrayDisposalWarnings(cells, WEEK).size).toBe(0);
  });
});

describe("computeBlockedWellsByInstrumentAndDay", () => {
  it("blocks a stopped cell's well only while its own tray is loaded, not after a later tray takes the well over", () => {
    // Tray 1's D01 cell was stopped; tray 1 founded Monday. Tray 2 is founded Thursday and
    // reuses the same D01 well letter - so D01 belongs to tray 1 (blocked) Mon-Wed, then to
    // tray 2's live cell (not blocked) Thu-Fri.
    const stoppedD = baseCell({
      id: 1,
      tray_id: 1,
      current_well: "D01",
      current_instrument_serial: "84047",
      status: "stopped",
      first_use_planned_start_at: "2026-07-20T12:00:00Z", // Monday founding
    });
    const nextTrayD = baseCell({
      id: 2,
      tray_id: 2,
      current_well: "D01",
      current_instrument_serial: "84047",
      status: "open",
      uses_consumed: 0,
      uses_remaining: 3,
      last_use_run_date: null,
      first_use_planned_start_at: "2026-07-23T12:00:00Z", // Thursday founding
    });
    const cells = [stoppedD, nextTrayD];
    const founding = computeTrayFoundingDates(cells);
    const blocked = computeBlockedWellsByInstrumentAndDay(cells, WEEK, founding);

    expect(blocked.get("84047")?.get("2026-07-20")?.has("D01")).toBe(true); // Mon
    expect(blocked.get("84047")?.get("2026-07-22")?.has("D01")).toBe(true); // Wed
    expect(blocked.get("84047")?.get("2026-07-23")?.has("D01")).toBeFalsy(); // Thu - tray 2's well now
    expect(blocked.get("84047")?.get("2026-07-24")?.has("D01")).toBeFalsy(); // Fri
  });

  it("falls back to blocking on every visible day for a legacy stopped cell with no tray", () => {
    const legacy = baseCell({
      id: 5,
      tray_id: null,
      current_well: "C01",
      current_instrument_serial: "84047",
      status: "stopped",
    });
    const blocked = computeBlockedWellsByInstrumentAndDay([legacy], WEEK, new Map());
    for (const day of WEEK) {
      expect(blocked.get("84047")?.get(day)?.has("C01")).toBe(true);
    }
  });
});
