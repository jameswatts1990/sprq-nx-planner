import { describe, expect, it } from "vitest";

import type { CellOut } from "@/types/cell";

import {
  breakoutOffsetH,
  cellExpiryState,
  computeInstrumentTrayMaps,
  usesRemainingAt,
  type TrayPositionView,
} from "./instrumentTrayMaps";
import { computeTrayEvictionDates, computeTrayFoundingDates, computeVacatedTrayIds } from "./waitingCells";

const WEEK = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24"];
const SERIAL = "84047";

function cell(overrides: Partial<CellOut> = {}): CellOut {
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
    current_instrument_serial: SERIAL,
    current_well: "A01",
    last_use_run_date: null,
    first_use_started_at: null,
    first_use_planned_start_at: null,
    created_at: "2026-07-20T12:00:00Z",
    stopped_reason: null,
    stopped_at: null,
    discarded_reason: null,
    discarded_at: null,
    has_failed_use: false,
    needs_qc_report: false,
    awaiting_credit: false,
    pacbio_case_number: null,
    pacbio_reported_at: null,
    pacbio_credit_confirmed_at: null,
    credit_received_at: null,
    tray_id: 1,
    tray_position: 1,
    tray_size: 4,
    uses: [],
    ...overrides,
  };
}

/** A tray of 4 cells sharing one carousel position (well letters A-D of `col`, e.g. "01"). */
function trayCells(trayId: number, col: "01" | "02", overridesByPos: Partial<CellOut>[] = []): CellOut[] {
  const letters = ["A", "B", "C", "D"];
  return letters.map((letter, i) =>
    cell({
      id: trayId * 10 + i,
      code: `CELL-${letter}00${trayId}0${i}`,
      tray_id: trayId,
      tray_position: i + 1,
      current_well: `${letter}${col}`,
      ...overridesByPos[i],
    }),
  );
}

/** Rebuilds the tray-derivation maps the same way SchedulePage does, so tests exercise the
 * real residency inputs rather than hand-rolled maps. */
function derive(cells: CellOut[]) {
  const founding = computeTrayFoundingDates(cells);
  const eviction = computeTrayEvictionDates(cells, founding);
  const vacated = computeVacatedTrayIds(cells);
  return { founding, eviction, vacated };
}

function build(cells: CellOut[]) {
  const { founding, eviction, vacated } = derive(cells);
  return computeInstrumentTrayMaps(cells, WEEK, founding, eviction, vacated);
}

describe("computeInstrumentTrayMaps", () => {
  it("shows a single used tray in the Plate 1 position with uses remaining and expiry", () => {
    // Confirmed loads: the backend already bakes each cell's ~2h breakout stagger into
    // first_use_started_at (cell 1 at load, cell 2 at load+2h), so the map reads them as-is.
    const cells = trayCells(1, "01", [
      { uses_consumed: 2, uses_remaining: 1, last_use_run_date: "2026-07-21", first_use_started_at: "2026-07-20T12:00:00Z" },
      { uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2026-07-20", first_use_started_at: "2026-07-20T14:00:00Z" },
    ]);
    const map = build(cells).get(SERIAL)!;

    // Anchored to the week's first day, never a later scheduled day.
    expect(map.asOfDate).toBe("2026-07-20");
    expect(map.weekEndDate).toBe("2026-07-24");
    expect(map.futureTrays).toEqual([]);
    expect(map.carousel[1]).toBeNull(); // nothing in Plate 2 position
    const tray = map.carousel[0]!;
    expect(tray.trayId).toBe(1);
    expect(tray.positions.map((p) => p.cellNumber)).toEqual([1, 2, 3, 4]);
    expect(tray.positions[0]).toMatchObject({ usesRemaining: 1, status: "open" });
    expect(tray.positions[1]).toMatchObject({ usesRemaining: 2 });
    // Cell 1 broke out at its confirmed anchor 2026-07-20T12:00Z + 108h = 2026-07-25T00:00Z.
    expect(tray.positions[0].expiryAt).toBe("2026-07-25T00:00:00.000Z");
    expect(tray.positions[0].provisional).toBe(false);
    // Cell 2's confirmed anchor is already 2h later (backend stagger), so it expires 2h later too -
    // NOT re-staggered by the map on top of the anchor.
    expect(tray.positions[1].expiryAt).toBe("2026-07-25T02:00:00.000Z");
    // Never-used C/D siblings have no anchor -> no expiry.
    expect(tray.positions[2].expiryAt).toBeNull();
  });

  it("derives each cell's per-use breakout instants (staggered) for the live count", () => {
    const cells = trayCells(1, "01", [
      {
        uses_consumed: 2,
        uses_remaining: 1,
        first_use_started_at: "2026-07-20T12:00:00Z",
        last_use_run_date: "2026-07-24",
        // A completed Use 1 (Mon) and a still-planned Use 2 (Fri); a cancelled marker is ignored.
        uses: [
          { id: 1, run_batch_id: 1, run_name: "R1", sample_id: 1, sample_external_id: "s1", well: "A01", status: "completed", run_started: true, breakout_anchor_at: "2026-07-20T12:00:00Z" },
          { id: 2, run_batch_id: 2, run_name: "R2", sample_id: 2, sample_external_id: "s2", well: "A01", status: "planned", run_started: false, breakout_anchor_at: "2026-07-24T12:00:00Z" },
          { id: 3, run_batch_id: 3, run_name: "R3", sample_id: 3, sample_external_id: "s3", well: "A01", status: "cancelled", run_started: false, breakout_anchor_at: "2026-07-22T12:00:00Z" },
        ],
      },
    ]);
    const tray = build(cells).get(SERIAL)!.carousel[0]!;
    const cell1 = tray.positions[0]; // cellNumber 1, offset 0 -> anchors unchanged
    expect(cell1.maxUses).toBe(3);
    expect(cell1.useBreakoutsMs).toEqual([Date.parse("2026-07-20T12:00:00Z"), Date.parse("2026-07-24T12:00:00Z")]);
    // Committed-plan figure preserved; live count is higher before the 2nd use breaks out.
    expect(cell1.usesRemaining).toBe(1);
    expect(usesRemainingAt(cell1, Date.parse("2026-07-20T14:00:00Z"))).toBe(2);
  });

  it("only staggers a use's breakout when it is still planned, not once it has started", () => {
    // Cell 2 (offset +2h). Its started Use 1 already carries the backend stagger in started_at, so
    // its breakout_anchor_at is used as-is; a still-planned Use 2 quotes the shared plate start, so
    // the +2h estimate is applied to it here.
    const cells = trayCells(1, "01", [
      {}, // cell 1
      {
        uses_consumed: 1,
        uses_remaining: 2,
        first_use_started_at: "2026-07-20T14:00:00Z", // load 12:00 + cell-2 stagger
        last_use_run_date: "2026-07-24",
        uses: [
          { id: 1, run_batch_id: 1, run_name: "R1", sample_id: 1, sample_external_id: "s1", well: "B01", status: "completed", run_started: true, breakout_anchor_at: "2026-07-20T14:00:00Z" },
          { id: 2, run_batch_id: 2, run_name: "R2", sample_id: 2, sample_external_id: "s2", well: "B01", status: "planned", run_started: false, breakout_anchor_at: "2026-07-24T12:00:00Z" },
        ],
      },
    ]);
    const cell2 = build(cells).get(SERIAL)!.carousel[0]!.positions[1];
    expect(cell2.useBreakoutsMs).toEqual([
      Date.parse("2026-07-20T14:00:00Z"), // started: anchor as-is, no extra offset
      Date.parse("2026-07-24T14:00:00Z"), // planned: shared plate start + 2h stagger estimate
    ]);
  });

  it("places a *02 tray in the Plate 2 carousel position", () => {
    const cells = trayCells(2, "02", [{ uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2026-07-20", first_use_started_at: "2026-07-20T12:00:00Z" }]);
    const map = build(cells).get(SERIAL)!;
    expect(map.carousel[0]).toBeNull();
    expect(map.carousel[1]!.trayId).toBe(2);
  });

  it("reads a confirmed load's already-staggered per-cell anchors as-is (no double stagger)", () => {
    // A confirmed run: the backend has already anchored each cell at load + its breakout offset
    // (cell 1 +0h, cell 2 +2h, … ; the Plate-2 tray ~+24h). The map must pass those through, NOT
    // add the stagger a second time - that was the "staggered twice after the backend fix" bug (v0.33.1).
    const used = (h: number, day = 20) => ({
      uses_consumed: 1,
      uses_remaining: 2,
      last_use_run_date: "2026-07-20",
      first_use_started_at: `2026-07-${day}T${String(12 + h).padStart(2, "0")}:00:00Z`,
    });
    const p1 = trayCells(1, "01", [used(0), used(2), used(4), used(6)]);
    const p2 = trayCells(2, "02", [used(0, 21), used(2, 21), used(4, 21), used(6, 21)]);
    const map = build([...p1, ...p2]).get(SERIAL)!;
    // Plate 1 tray: expiry = each cell's own confirmed anchor + 108h.
    expect(map.carousel[0]!.positions.map((p) => p.expiryAt)).toEqual([
      "2026-07-25T00:00:00.000Z",
      "2026-07-25T02:00:00.000Z",
      "2026-07-25T04:00:00.000Z",
      "2026-07-25T06:00:00.000Z",
    ]);
    // Plate 2 tray's cells were confirmed ~24h later, so their windows close a day on.
    expect(map.carousel[1]!.positions[0].expiryAt).toBe("2026-07-26T00:00:00.000Z");
    expect(map.carousel[1]!.positions[3].expiryAt).toBe("2026-07-26T06:00:00.000Z");
  });

  it("staggers a still-PLANNED tray's expiry on the fly (2h apart; +24h for Plate 2)", () => {
    // Before Confirm-loaded there is no per-cell anchor yet - all four cells quote the single
    // shared plate planned_start_at - so the map itself applies the breakout ladder as a
    // provisional estimate (this is what breakoutOffsetH is still for).
    const planned = { uses_consumed: 0, uses_remaining: 3, last_use_run_date: null, first_use_started_at: null, first_use_planned_start_at: "2026-07-20T12:00:00Z" };
    const p1 = trayCells(1, "01", [planned, planned, planned, planned]);
    const p2 = trayCells(2, "02", [planned, planned, planned, planned]);
    const map = build([...p1, ...p2]).get(SERIAL)!;
    expect(map.carousel[0]!.positions.map((p) => p.expiryAt)).toEqual([
      "2026-07-25T00:00:00.000Z",
      "2026-07-25T02:00:00.000Z",
      "2026-07-25T04:00:00.000Z",
      "2026-07-25T06:00:00.000Z",
    ]);
    expect(map.carousel[0]!.positions.every((p) => p.provisional)).toBe(true);
    // Plate 2 tray shares the same planned load anchor but its cells break out ~24h later.
    expect(map.carousel[1]!.positions[0].expiryAt).toBe("2026-07-26T00:00:00.000Z");
    expect(map.carousel[1]!.positions[3].expiryAt).toBe("2026-07-26T06:00:00.000Z");
  });

  it("marks a planned-but-unconfirmed first use's expiry as provisional", () => {
    const cells = trayCells(1, "01", [
      { uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2026-07-20", first_use_started_at: null, first_use_planned_start_at: "2026-07-20T12:00:00Z" },
    ]);
    const p = build(cells).get(SERIAL)!.carousel[0]!.positions[0];
    expect(p.expiryAt).toBe("2026-07-25T00:00:00.000Z");
    expect(p.provisional).toBe(true);
  });

  it("shows 0 usable uses for a terminal cell even if it physically has capacity left (disposed early)", () => {
    const cells = trayCells(1, "01", [
      // Disposed at a 2x dial: exhausted, but physically 1 use unspent - not runnable, so 0.
      { status: "exhausted", uses_consumed: 2, uses_remaining: 1, last_use_run_date: "2026-07-20", first_use_started_at: "2026-07-20T12:00:00Z" },
    ]);
    const tray = build(cells).get(SERIAL)!.carousel[0]!;
    expect(tray.positions[0]).toMatchObject({ status: "exhausted", usesRemaining: 0 });
  });

  it("keeps the current tray up top and lists a mid-week successor as a future tray (turnover)", () => {
    // Tray 1 (open, used, resident at the week's start) ages out mid-week; tray 2 is loaded
    // Wed into the same A01-D01 position -> tray 1 evicted Wed, so at Mon it's still current
    // and tray 2 shows in the "loaded later" group by id only.
    const oldTray = trayCells(1, "01", [
      { uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2026-07-20", first_use_started_at: "2026-07-20T12:00:00Z" },
    ]);
    const newTray = trayCells(2, "01", [
      { uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2026-07-23", first_use_started_at: "2026-07-23T12:00:00Z" },
    ]);
    const map = build([...oldTray, ...newTray]).get(SERIAL)!;

    expect(map.carousel[0]!.trayId).toBe(1); // the current tray, with full state
    expect(map.futureTrays).toEqual([{ trayId: 2, carousel: 0, foundingDate: "2026-07-23" }]);
  });

  it("promotes a mid-week tray into the slot when nothing usable is resident at the week's start", () => {
    // Every cell of tray 1 is exhausted -> vacated (physically gone), so nothing is shown in the
    // slot at the week's start; tray 2, founded Wed, is then this position's only usable tray, so
    // it fills the slot rather than being relegated to the "loaded later" turnover group.
    const oldTray = trayCells(1, "01", [0, 1, 2, 3].map(() => ({
      uses_consumed: 3,
      uses_remaining: 0,
      status: "exhausted" as const,
      last_use_run_date: "2026-07-20",
      first_use_started_at: "2026-07-20T12:00:00Z",
    })));
    const newTray = trayCells(2, "01", [
      { uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2026-07-23", first_use_started_at: "2026-07-23T12:00:00Z" },
    ]);
    const map = build([...oldTray, ...newTray]).get(SERIAL)!;

    expect(map.carousel[0]!.trayId).toBe(2);
    expect(map.futureTrays).toEqual([]);
  });

  it("shows a tray first loaded mid-week in its slot, not 'loaded later', when it's the position's only tray", () => {
    // A brand-new run scheduled on Wed with no earlier tray in that position: the tray belongs in
    // the carousel slot, not the "loaded later" group (which is only for a genuine turnover of a
    // tray already resident this week).
    const cells = trayCells(3, "01", [
      { uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2026-07-22", first_use_started_at: "2026-07-22T12:00:00Z" },
    ]);
    const map = build(cells).get(SERIAL)!;
    expect(map.carousel[0]!.trayId).toBe(3);
    expect(map.futureTrays).toEqual([]);
  });

  it("treats a fully-vacated tray with no successor as an empty carousel position", () => {
    const cells = trayCells(1, "01", [
      { uses_consumed: 3, uses_remaining: 0, status: "exhausted", last_use_run_date: "2026-07-20", first_use_started_at: "2026-07-20T12:00:00Z" },
      { uses_consumed: 3, uses_remaining: 0, status: "exhausted", last_use_run_date: "2026-07-20", first_use_started_at: "2026-07-20T12:00:00Z" },
      { uses_consumed: 0, uses_remaining: 0, status: "retired", last_use_run_date: null },
      { uses_consumed: 0, uses_remaining: 0, status: "retired", last_use_run_date: null },
    ]);
    const map = build(cells).get(SERIAL)!;
    expect(map.carousel[0]).toBeNull();
    expect(map.futureTrays).toEqual([]);
  });

  it("still shows a resident, never-evicted tray whose last use predates the viewed week", () => {
    const cells = trayCells(1, "01", [
      { uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2020-01-06", first_use_started_at: "2020-01-06T12:00:00Z" },
    ]);
    const map = build(cells).get(SERIAL)!;
    expect(map.asOfDate).toBe("2026-07-20");
    expect(map.carousel[0]!.trayId).toBe(1);
  });

  it("ignores cells with no tray or on another instrument", () => {
    const cells = [
      cell({ id: 99, tray_id: null, tray_position: null }),
      cell({ id: 98, current_instrument_serial: "84098", tray_id: 5, current_well: "A01" }),
    ];
    const maps = build(cells);
    expect(maps.get(SERIAL)).toBeUndefined(); // no tray-linked cells on 84047
    expect(maps.get("84098")!.carousel[0]!.trayId).toBe(5);
  });
});

/** A tray position with sensible defaults (open cell, breakout Mon noon, expiry Sat 00:00). */
function pos(overrides: Partial<TrayPositionView> = {}): TrayPositionView {
  return {
    cellId: 1,
    code: "CELL-A000001",
    cellNumber: 1,
    usesRemaining: 2,
    maxUses: 3,
    useBreakoutsMs: [],
    status: "open",
    breakoutAt: "2026-07-20T12:00:00.000Z",
    expiryAt: "2026-07-25T00:00:00.000Z", // breakout + 108h
    provisional: false,
    ...overrides,
  };
}

describe("cellExpiryState", () => {
  const REF = Date.parse("2026-07-24T12:00:00Z"); // Fri noon

  it("is 'ok' with comfortable window and 'soon' within a day of the deadline", () => {
    expect(cellExpiryState(pos({ expiryAt: "2026-07-28T00:00:00Z" }), REF)).toBe("ok");
    expect(cellExpiryState(pos({ expiryAt: "2026-07-25T00:00:00Z" }), REF)).toBe("soon"); // 12h left
  });

  it("is 'expired' once the reference instant passes the deadline", () => {
    expect(cellExpiryState(pos({ expiryAt: "2026-07-24T06:00:00Z" }), REF)).toBe("expired");
  });

  it("is 'scheduled' while the breakout is still in the future", () => {
    expect(
      cellExpiryState(pos({ breakoutAt: "2026-07-27T12:00:00Z", expiryAt: "2026-08-01T00:00:00Z" }), REF),
    ).toBe("scheduled");
  });

  it("is 'fresh' for an open cell with no clock, 'spent'/'expired' for terminal cells", () => {
    expect(cellExpiryState(pos({ breakoutAt: null, expiryAt: null }), REF)).toBe("fresh");
    expect(cellExpiryState(pos({ status: "exhausted" }), REF)).toBe("spent");
    expect(cellExpiryState(pos({ status: "retired" }), REF)).toBe("spent");
    expect(cellExpiryState(pos({ status: "window_expired" }), REF)).toBe("expired");
    expect(cellExpiryState(pos({ status: "stopped" }), REF)).toBe("expired");
  });
});

describe("usesRemainingAt", () => {
  // Two committed uses: first breaks out Mon noon, second Fri noon; capacity 3.
  const twoUses = pos({
    usesRemaining: 1, // committed-plan figure (3 - 2 scheduled uses)
    maxUses: 3,
    useBreakoutsMs: [Date.parse("2026-07-20T12:00:00Z"), Date.parse("2026-07-24T12:00:00Z")],
  });

  it("counts down only uses that have broken out by the reference instant", () => {
    // Before any breakout: full capacity, nothing physically consumed yet.
    expect(usesRemainingAt(twoUses, Date.parse("2026-07-20T00:00:00Z"))).toBe(3);
    // Mon 14:00: only the first use has broken out -> 2 left (not the planned 1).
    expect(usesRemainingAt(twoUses, Date.parse("2026-07-20T14:00:00Z"))).toBe(2);
    // End of week: both broken out -> converges on the committed-plan figure.
    expect(usesRemainingAt(twoUses, Date.parse("2026-07-24T23:59:59Z"))).toBe(1);
  });

  it("reads 0 for a terminal/stopped cell regardless of the reference", () => {
    const early = Date.parse("2026-07-20T00:00:00Z");
    expect(usesRemainingAt(pos({ status: "exhausted", useBreakoutsMs: [] }), early)).toBe(0);
    expect(usesRemainingAt(pos({ status: "stopped", useBreakoutsMs: [] }), early)).toBe(0);
  });
});

describe("breakoutOffsetH", () => {
  it("adds 2h per position within a tray and 24h for the Plate 2 carousel", () => {
    expect([1, 2, 3, 4].map((n) => breakoutOffsetH(0, n))).toEqual([0, 2, 4, 6]);
    expect([1, 2, 3, 4].map((n) => breakoutOffsetH(1, n))).toEqual([24, 26, 28, 30]);
  });
});
