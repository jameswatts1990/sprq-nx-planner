import { describe, expect, it } from "vitest";

import type { CellOut } from "@/types/cell";

import { computeTrayEvictionDates, computeTrayFoundingDates } from "./waitingCells";

function baseCell(overrides: Partial<CellOut> = {}): CellOut {
  const lastUseRunDate = overrides.last_use_run_date !== undefined ? overrides.last_use_run_date : "2026-07-13";
  return {
    id: 1,
    code: "CELL-000001",
    max_uses: 3,
    cell_type: "sprq_nx",
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
    credit_owner: null,
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
    const neverUsed = baseCell({ id: 2, tray_id: 4, uses_consumed: 0, last_use_run_date: null, first_use_planned_start_at: null });

    expect(computeTrayFoundingDates([untracked, neverUsed]).size).toBe(0);
  });

  it("still anchors a tray on a founding cell that has since been stopped", () => {
    // A stopped cell must stay in the tray universe: it still dates its tray's founding (and so
    // the tray's tenure/eviction and the tray-panel residency).
    const stoppedFounder = baseCell({ id: 1, tray_id: 6, status: "stopped", first_use_planned_start_at: "2026-07-13T12:00:00Z" });
    const openSibling = baseCell({ id: 2, tray_id: 6, first_use_planned_start_at: "2026-07-15T12:00:00Z" });

    expect(computeTrayFoundingDates([stoppedFounder, openSibling]).get(6)).toBe("2026-07-13");
  });
});

describe("computeTrayEvictionDates", () => {
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

  it("never lets a tray in the other bay, or on another instrument, evict it", () => {
    const otherBay = { ...successorCell, id: 705, current_well: "D02" };
    const otherInstrument = { ...successorCell, id: 706, tray_id: 78, current_instrument_serial: "84309" };
    const cells = [oldTrayCell, otherBay, otherInstrument];
    const eviction = computeTrayEvictionDates(cells, computeTrayFoundingDates(cells));
    expect(eviction.has(76)).toBe(false);
  });
});
