import { describe, expect, it } from "vitest";

import type { CellOut } from "@/types/cell";

import type { StageOut } from "@/types/schedule";

import {
  computeBlockedWellsByInstrumentAndDay,
  computeGhost,
  computeTerminalGhost,
  computeTrayEvictionDates,
  computeTrayFoundingDates,
  computeVacatedTrayIds,
  ghostWouldClashWithSample,
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
    reuse_ready_at: null,
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
    internal_report_id: null,
    internal_report_at: null,
    pacbio_case_number: null,
    pacbio_reported_at: null,
    pacbio_credit_confirmed_at: null,
    credit_acquisitions: null,
    credit_notes: null,
    credit_received_at: null,
    discarded_reason: null,
    discarded_at: null,
    tray_id: null,
    tray_position: null,
    tray_size: 4,
    tray_reuse_disabled: false,
    uses: [],
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

  it("delays the reuse ghost to the day the cell is physically free (prep-aware), not just the next weekday", () => {
    // Last used Monday, but its (long/late) movie only finishes Wed 02:00 (reuse_ready_at) - so the
    // cell isn't free on Tuesday even though Tuesday is the next weekday. The ghost must wait for Wed.
    const cell = baseCell({
      uses_consumed: 1,
      uses_remaining: 2,
      last_use_run_date: "2026-07-13", // Monday
      reuse_ready_at: "2026-07-15T02:00:00Z", // Wednesday 02:00 - the prep-aware movie end
    });
    expect(computeGhost(cell, "2026-07-14")).toBeNull(); // Tuesday - cell still sequencing
    expect(computeGhost(cell, "2026-07-15")?.useNumber).toBe(2); // Wednesday - now free
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

  it("returns no ghost for a day before this cell's own (not-yet-run) next use - a plain + now", () => {
    // Only 1 of 3 uses consumed, its one real use booked for Thursday. Monday used to paint a
    // muted "Scheduled" marker on this well; now those pending markers are gone - a slot is
    // blocked only by the instrument lock, so an earlier unlocked day is just a plain,
    // droppable "+" (the drop resolves through the server's derive_best_cell like any other).
    const cell = baseCell({ uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2026-07-16" }); // Thursday

    expect(computeGhost(cell, "2026-07-13")).toBeNull(); // Monday, before the Thursday use
    // The last-use day itself (Thursday) also renders null - the real stage covers it - and
    // Friday onward resumes the ordinary reuse-eligible ghost.
    expect(computeGhost(cell, "2026-07-16")).toBeNull();
    const fri = computeGhost(cell, "2026-07-17");
    expect(fri?.useNumber).toBe(2);
    expect(fri?.terminalStatus).toBeUndefined();
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

describe("ghostWouldClashWithSample", () => {
  const sample = { external_id: "TRAC-2-99999", barcodes: ["bc1"] };

  it("is false with no ghost, a terminal ghost, or a sample with no barcodes", () => {
    expect(ghostWouldClashWithSample(undefined, sample)).toBe(false);
    const terminal = computeTerminalGhost(baseCell({ status: "exhausted", burned_barcodes: ["bc1"] }), "2026-07-14")!;
    expect(ghostWouldClashWithSample(terminal, sample)).toBe(false);
    const ghost = computeGhost(baseCell({ burned_barcodes: ["bc1"] }), "2026-07-14")!;
    expect(ghostWouldClashWithSample(ghost, { external_id: "X", barcodes: [] })).toBe(false);
  });

  it("is false when the cell has no burned barcodes, or none overlap the dragged sample's", () => {
    const noBurns = computeGhost(baseCell({ burned_barcodes: [] }), "2026-07-14")!;
    expect(ghostWouldClashWithSample(noBurns, sample)).toBe(false);
    const differentBarcode = computeGhost(baseCell({ burned_barcodes: ["bc2"] }), "2026-07-14")!;
    expect(ghostWouldClashWithSample(differentBarcode, sample)).toBe(false);
  });

  it("is true when the cell already burned this barcode under a DIFFERENT Container ID", () => {
    const ghost = computeGhost(
      baseCell({ burned_barcodes: ["bc1"], uses: [{ id: 1, run_batch_id: 1, run_name: null, sample_id: 1, sample_external_id: "OTHER-SAMPLE", well: "A01", status: "planned", run_started: false, breakout_anchor_at: null }] }),
      "2026-07-14",
    )!;
    expect(ghostWouldClashWithSample(ghost, sample)).toBe(true);
  });

  it("is false when the dragged sample's own Container ID already used this cell (duplicate self-reuse, not a clash)", () => {
    const ghost = computeGhost(
      baseCell({ burned_barcodes: ["bc1"], uses: [{ id: 1, run_batch_id: 1, run_name: null, sample_id: 1, sample_external_id: sample.external_id, well: "A01", status: "planned", run_started: false, breakout_anchor_at: null }] }),
      "2026-07-14",
    )!;
    expect(ghostWouldClashWithSample(ghost, sample)).toBe(false);
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

  it("surfaces a real reuse offer but NOT never-used tray siblings (a grid slot is a well; an unused sibling is just a plain '+')", () => {
    // A grid slot is a physical well that gets a cell assigned when a sample is loaded onto it
    // (see CLAUDE.md's "wells assigned a cell on a tray" model). A never-yet-used tray sibling
    // is therefore NOT surfaced as its own phantom card any more - its well reads as a plain
    // droppable "+", and dropping there assigns that sibling automatically (backend
    // derive_best_cell). Only a used cell resident in its well, on its 108h clock, is offered.
    const reused = baseCell({ id: 1, current_instrument_serial: "84047", current_well: "A01", last_use_run_date: "2026-07-13" });
    const sibling = baseUnusedTraySibling({ id: 2, current_instrument_serial: "84047", current_well: "B01" });

    const grouped = groupWaitingCellsByInstrumentAndDay([reused, sibling], ["2026-07-14"]);
    const ghosts = grouped.get("84047")?.get("2026-07-14") ?? [];

    // Only the reuse offer (cell 1). The unused sibling (cell 2) contributes no ghost at all.
    expect(ghosts.map((g) => g.cell.id)).toEqual([1]);
  });

  it("never surfaces a tray's never-used siblings, whether before or on the founding day", () => {
    // A tray's founding cell scheduled for its first-ever use on Friday, with 3 never-used
    // siblings already registered by eager population. Neither the founding cell (a day before
    // its own use is a plain "+") nor its never-used siblings (their wells are plain "+") show
    // any ghost - the grid only ever surfaces real placements, reuse offers, and spent-well
    // markers, never a phantom card for capacity that hasn't been loaded.
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

    // Monday (before the Friday founding use): no ghosts at all.
    const monGhosts = groupWaitingCellsByInstrumentAndDay(cells, ["2026-07-13"], new Set(), trayFoundingDates)
      .get("84047")
      ?.get("2026-07-13");
    expect(monGhosts).toBeUndefined();

    // Friday (the founding cell's own use day): the real placement covers the founding cell,
    // and the 3 unused siblings are just plain "+" - still no ghosts.
    const friGhosts = groupWaitingCellsByInstrumentAndDay(cells, ["2026-07-17"], new Set(), trayFoundingDates)
      .get("84047")
      ?.get("2026-07-17");
    expect(friGhosts).toBeUndefined();
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

describe("computeTerminalGhost's day-gating", () => {
  it("stays silent between an exhausted cell's own real placements, terminal only after the last one", () => {
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

    // Tuesday / Thursday - the gap days between real placements. No pending "Scheduled" card
    // any more: the well shows a plain "+" (blocked only by the lock), and the terminal card
    // stays hidden until the cell has actually finished its last scheduled use.
    expect(computeTerminalGhost(cell, "2026-07-14")).toBeNull();
    expect(computeTerminalGhost(cell, "2026-07-16")).toBeNull();

    // The following Monday, after the actual last use (Friday) - now genuinely terminal.
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

    // Wednesday - after last_use_run_date, but well before the 108h deadline actually closes:
    // no marker yet (plain "+").
    expect(computeTerminalGhost(cell, "2026-07-15")).toBeNull();

    // The following Monday - well after the deadline closed: the terminal marker shows.
    expect(computeTerminalGhost(cell, "2026-07-20")?.terminalStatus).toBe("window_expired");
  });

  it("never gates retired - it has no scheduling-driven boundary, so it stays terminal on every visible weekday", () => {
    // tray_id set for the same isolation-from-vacated-gating reason as the tests above.
    const cell = baseCell({ status: "retired", last_use_run_date: "2026-07-17", tray_id: 22 });
    expect(computeTerminalGhost(cell, "2026-07-14")?.terminalStatus).toBe("retired");
  });
});

describe("pinGhostsToSlots", () => {
  const EMPTY_SLOTS: (StageOut | null)[] = [null, null, null, null, null, null, null, null];

  // A cell reusable in its own well D01 (index 3), used once Monday.
  const ghostD01 = () =>
    computeGhost(
      baseCell({
        id: 699,
        code: "CELL-D000699",
        tray_id: 1,
        current_well: "D01",
        uses_consumed: 1,
        uses_remaining: 2,
        last_use_run_date: "2026-07-20",
        first_use_planned_start_at: "2026-07-20T12:00:00Z",
      }),
      "2026-07-21",
    )!;

  it("pins a ghost to the slot index matching its cell's own well (D01 -> slot 3)", () => {
    const bySlot = pinGhostsToSlots([ghostD01()], EMPTY_SLOTS);
    expect(bySlot.get(3)?.cell.id).toBe(699);
  });

  it("never pins a ghost onto a slot already holding a real placement", () => {
    const slots = [...EMPTY_SLOTS];
    slots[3] = { slot_index: 3 } as StageOut;
    const bySlot = pinGhostsToSlots([ghostD01()], slots);
    expect(bySlot.has(3)).toBe(false);
  });
});

describe("computeTrayEvictionDates + reuse suppression", () => {
  // Tray 76 in wells A01-D01 founded Monday; tray 77 founded Thursday in the SAME carousel
  // position (well D01 here - the successor need not refill every well of the old tray).
  const oldTrayCell = baseCell({
    id: 699,
    code: "CELL-D000699",
    tray_id: 76,
    current_well: "D01",
    current_instrument_serial: "84047",
    status: "open",
    uses_consumed: 2,
    uses_remaining: 1,
    last_use_run_date: "2026-07-22", // Wednesday
    first_use_started_at: "2026-07-20T12:00:00Z", // Monday - 108h window alone runs past Wed
  });
  const successorCell = baseCell({
    id: 703,
    code: "CELL-D000703",
    tray_id: 77,
    current_well: "D01",
    current_instrument_serial: "84047",
    status: "open",
    uses_consumed: 0,
    uses_remaining: 3,
    last_use_run_date: null,
    first_use_started_at: null,
    first_use_planned_start_at: "2026-07-23T12:00:00Z", // Thursday founding
  });

  it("maps a tray to the founding date of the next tray in its carousel position", () => {
    const cells = [oldTrayCell, successorCell];
    const eviction = computeTrayEvictionDates(cells, computeTrayFoundingDates(cells));
    expect(eviction.get(76)).toBe("2026-07-23"); // tray 76 evicted when tray 77 founds Thursday
    expect(eviction.has(77)).toBe(false); // the currently-loaded tray has no successor
  });

  it("evicts based on carousel position even when the successor doesn't refill the same well", () => {
    // Successor tray 77 lands in A01 (not D01), but it's still the same physical position, so
    // tray 76's D01 cell is evicted all the same.
    const successorInA = { ...successorCell, id: 704, code: "CELL-A000704", current_well: "A01" };
    const cells = [oldTrayCell, successorInA];
    const eviction = computeTrayEvictionDates(cells, computeTrayFoundingDates(cells));
    expect(eviction.get(76)).toBe("2026-07-23");
  });

  it("stops offering an evicted tray's cell for reuse from the successor's founding day on", () => {
    const eviction = computeTrayEvictionDates([oldTrayCell, successorCell], computeTrayFoundingDates([oldTrayCell, successorCell]));
    const founding = computeTrayFoundingDates([oldTrayCell, successorCell]);
    // Before eviction (Wednesday is its last use; earliest reuse is Thursday, already evicted)
    // there's no reuse day left at all - and Thursday/Friday must be null, never a ghost.
    expect(computeGhost(oldTrayCell, "2026-07-23", founding, eviction)).toBeNull(); // Thu
    expect(computeGhost(oldTrayCell, "2026-07-24", founding, eviction)).toBeNull(); // Fri
    // Without the eviction map, the old cell would wrongly still be offered on Thursday.
    expect(computeGhost(oldTrayCell, "2026-07-23", founding)).not.toBeNull();
  });

  it("caps an evicted cell's reuse ghost at the day before eviction, not its 108h expiry", () => {
    // A cell last used Monday would normally be reusable Tue-Fri (108h). With its tray evicted
    // Thursday, Tuesday and Wednesday remain, but Thursday onward is gone.
    const cell = { ...oldTrayCell, uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2026-07-20" };
    const cells = [cell, successorCell];
    const eviction = computeTrayEvictionDates(cells, computeTrayFoundingDates(cells));
    const founding = computeTrayFoundingDates(cells);
    expect(computeGhost(cell, "2026-07-21", founding, eviction)).not.toBeNull(); // Tue - still there
    expect(computeGhost(cell, "2026-07-22", founding, eviction)?.isHardCutoff).toBe(true); // Wed - last day
    expect(computeGhost(cell, "2026-07-23", founding, eviction)).toBeNull(); // Thu - tray gone
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

  it("lifts a legacy (tray-less) stopped cell's block once a real tray-tracked successor is founded in its well", () => {
    // Regression test for the reported bug: a legacy stopped cell (tray_id null, so it has no
    // founding date of its own) permanently blocked its well even after a genuine successor
    // tray was founded there - the well never became droppable again, with no visible reason.
    // A legacy cell necessarily predates every tray-tracked founding on record for the same
    // well, so the block must end once one is.
    const legacy = baseCell({
      id: 5,
      tray_id: null,
      current_well: "C01",
      current_instrument_serial: "84047",
      status: "stopped",
    });
    const successor = baseCell({
      id: 6,
      tray_id: 3,
      current_well: "C01",
      current_instrument_serial: "84047",
      status: "open",
      uses_consumed: 0,
      uses_remaining: 3,
      last_use_run_date: null,
      first_use_planned_start_at: "2026-07-23T12:00:00Z", // Thursday founding
    });
    const cells = [legacy, successor];
    const founding = computeTrayFoundingDates(cells);
    const blocked = computeBlockedWellsByInstrumentAndDay(cells, WEEK, founding);

    expect(blocked.get("84047")?.get("2026-07-20")?.has("C01")).toBe(true); // Mon - still legacy's
    expect(blocked.get("84047")?.get("2026-07-22")?.has("C01")).toBe(true); // Wed - still legacy's
    expect(blocked.get("84047")?.get("2026-07-23")?.has("C01")).toBeFalsy(); // Thu - successor's well now
    expect(blocked.get("84047")?.get("2026-07-24")?.has("C01")).toBeFalsy(); // Fri
  });
});
